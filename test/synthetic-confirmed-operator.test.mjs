import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConfirmedSyntheticOperator } from './support/synthetic-confirmed-operator.mjs';
import { previewProviderResume } from '../dist/provider-preview.js';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { DatabaseSync } from 'node:sqlite';

const geometry = { seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } };
const limits = { cells: 2, submissions: 2, activeTime: 10000 };
const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
const bounds = () => ({ requestMilliseconds: 1000, activeUntil: Date.now() + 10000, maxObservations: 1, observationDeadline: Date.now() + 10000 });
function evidence(invocation) {
 const doc = { reference: 'synthetic', date: '2000-01-01', validThrough: '2099-12-31', scope: 'synthetic' };
 const technical = method => ({ ...doc, attestation: { method, invocation } });
 const commercial = () => ({ ...doc, attestation: { invocation, collection: true, storage: true, export: true } });
 return { evidence: { submission: technical('submission'), observation: technical('observation'), retrieval: technical('retrieval'), pricing: commercial(), rights: commercial() }, estimate: { currency: 'USD', amount: 1, assumptions: 'synthetic', uncertainty: 'synthetic', pricingReference: 'synthetic' } };
}
test('stale resume is rejected before owner mutation; fresh resume dispatches in ID order', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'confirmed-resume-')); const checkpoint = join(dir, 'db');
 try {
  DurableState.createBound(checkpoint, binding, createTraversal(geometry, limits));
  const requested = { submissions: 3 }; const effective = previewProviderResume(checkpoint, requested);
  const invocation = { operation: 'resume', query: { keyword: binding.keyword, country: binding.country }, geometry, limits: effective.limits, account: 'synthetic', dataset: 'synthetic' };
  const opts = { checkpoint, binding, limits: requested, bounds: bounds(), account: 'synthetic', dataset: 'synthetic', ...evidence(invocation) };
  const calls = []; const transport = { submit: async () => { calls.push('submit'); return { status: 202, body: { snapshot_id: 'resume-id' } }; }, observe: async id => { calls.push(`observe:${id}`); return { status: 200, body: { status: 'ready' } }; }, retrieve: async id => { calls.push(`retrieve:${id}`); return { status: 200, body: [] }; } };
  let changed;
  await assert.rejects(runConfirmedSyntheticOperator('resume', opts, async () => {
   const db = new DatabaseSync(checkpoint); const row = db.prepare('SELECT payload FROM traversal').get(); const state = JSON.parse(row.payload); state.paused = true; db.prepare('UPDATE traversal SET payload=?').run(JSON.stringify(state)); db.close();
   changed = previewProviderResume(checkpoint, requested).fingerprint; return true;
  }, transport), /stale/i);
  assert.deepEqual(calls, []); assert.equal(previewProviderResume(checkpoint, requested).fingerprint, changed);
  const db = new DatabaseSync(checkpoint); const row = db.prepare('SELECT payload FROM traversal').get(); const state = JSON.parse(row.payload); state.paused = false; db.prepare('UPDATE traversal SET payload=?').run(JSON.stringify(state)); db.close();
  const result = await runConfirmedSyntheticOperator('resume', opts, async shown => { assert.deepEqual(shown.invocation, invocation); return true; }, transport);
  assert.deepEqual(result.status.limits, invocation.limits); assert.deepEqual(calls, ['submit', 'observe:resume-id', 'retrieve:resume-id']);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('synthetic start and guarded resume require fresh preview affirmation before dispatch', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'confirmed-')); const checkpoint = join(dir, 'db');
 try {
  const calls = []; const transport = { submit: async () => { calls.push('submit'); return { status: 202, body: { snapshot_id: 'id-1' } }; }, observe: async id => { calls.push(`observe:${id}`); return { status: 200, body: { status: 'ready' } }; }, retrieve: async id => { calls.push(`retrieve:${id}`); return { status: 200, body: [] }; } };
  const invocation = { operation: 'start', query: { keyword: binding.keyword, country: binding.country }, geometry, limits, account: 'synthetic', dataset: 'synthetic' };
  const opts = { checkpoint, geometry, limits, binding, bounds: bounds(), account: 'synthetic', dataset: 'synthetic', ...evidence(invocation) };
  await assert.rejects(runConfirmedSyntheticOperator('start', opts, async () => false, transport));
  assert.equal(existsSync(checkpoint), false); assert.deepEqual(calls, []);
  await assert.rejects(runConfirmedSyntheticOperator('start', { ...opts, estimate: undefined }, async () => true, transport));
  assert.equal(existsSync(checkpoint), false); assert.deepEqual(calls, []);
  let shown;
  const result = await runConfirmedSyntheticOperator('start', opts, async preview => { shown = preview; return true; }, transport);
  assert.deepEqual(shown.invocation, invocation); assert.deepEqual(result.status.limits, shown.invocation.limits);
  assert.deepEqual(calls, ['submit', 'observe:id-1', 'retrieve:id-1']);
  const resumeLimits = { submissions: 3 }; const effective = previewProviderResume(checkpoint, resumeLimits);
  const resumeInvocation = { ...invocation, operation: 'resume', limits: effective.limits };
  const resumeOpts = { checkpoint, binding, limits: resumeLimits, bounds: bounds(), account: 'synthetic', dataset: 'synthetic', ...evidence(resumeInvocation) };
  const count = calls.length;
  await assert.rejects(runConfirmedSyntheticOperator('resume', resumeOpts, async () => false, transport));
  assert.equal(previewProviderResume(checkpoint, resumeLimits).fingerprint, effective.fingerprint); assert.equal(calls.length, count);
  const resumed = await runConfirmedSyntheticOperator('resume', resumeOpts, async preview => { assert.deepEqual(preview.invocation, resumeInvocation); return true; }, transport);
  assert.deepEqual(resumed.status.limits, resumeInvocation.limits); assert.equal(calls.length, count);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
