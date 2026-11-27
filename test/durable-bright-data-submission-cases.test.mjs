import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { submitDurableBrightData } from '../dist/durable-bright-data-submission.js';
const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
async function setup(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'provider-cases-')); const path = join(dir, 's.db');
  try { DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 5, submissions: 5, activeTime: 10000 })); const state = DurableState.openBound(path, binding); try { await fn(state); } finally { state.close(); } } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('unknown dispatched submission is parked and not resent', async () => setup(async state => {
  let calls = 0; const transport = { async submit() { calls++; throw Error('synthetic'); } };
  await submitDurableBrightData(state, transport, { requestMilliseconds: 1000, activeUntil: Date.now() + 10000 });
  assert.equal(state.readTraversal().attempts[0].status, 'uncertain');
  await assert.rejects(submitDurableBrightData(state, transport, { requestMilliseconds: 1000, activeUntil: Date.now() + 10000 }));
  assert.equal(calls, 1);
}));
test('pre-dispatch cutoff confirms no send', async () => setup(async state => {
  let calls = 0; await submitDurableBrightData(state, { async submit() { calls++; } }, { requestMilliseconds: 1000, activeUntil: 0 });
  assert.equal(calls, 0); assert.equal(state.readTraversal().attempts[0].status, 'confirmed_no_send');
}));
test('acknowledgement crossing cutoff persists ID and uncertainty gap', async () => setup(async state => {
  const original = Date.now; let now = original(); Date.now = () => now;
  try {
    await submitDurableBrightData(state, { async submit() { now += 100; return { status: 202, body: { snapshot_id: 'cutoff-id' } }; } }, { requestMilliseconds: 1000, activeUntil: now + 50 });
    const saved = state.readTraversal(); assert.equal(saved.attempts[0].knownId, 'cutoff-id'); assert.equal(saved.attempts[0].status, 'uncertain'); assert.equal(saved.gaps[0].cause, 'uncertain');
  } finally { Date.now = original; }
}));
