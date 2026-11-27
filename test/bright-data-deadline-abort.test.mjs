import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { runSyntheticBrightData } from '../dist/durable-bright-data-submission.js';
import { createBrightDataHttpCandidate } from '../dist/bright-data-http-candidate.js';

const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
for (const stage of ['submit', 'observe', 'retrieve']) for (const cutoff of ['active', 'request']) {
 test(`${stage} aborts local fetch at ${cutoff} deadline and isolates late response`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deadline-')); const path = join(dir, 'state.db');
  let state;
  try {
   DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 2, submissions: 2, activeTime: 10000 }));
   state = DurableState.openBound(path, binding);
   const calls = []; const pending = Promise.withResolvers(); let signal;
   const transport = createBrightDataHttpCandidate('synthetic', 5000, async (url, init) => {
    const kind = init.method === 'POST' ? 'submit' : url.includes('/progress/') ? 'observe' : 'retrieve';
    calls.push(kind);
    if (kind === stage) { signal = init.signal; return pending.promise; }
    return new Response(JSON.stringify(kind === 'submit' ? { snapshot_id: 'id' } : kind === 'observe' ? { status: 'ready' } : [{ name: 'Synthetic', place_id: 'p' }]), { status: kind === 'submit' ? 202 : 200 });
   });
   const now = Date.now();
   await runSyntheticBrightData(state, transport, { requestMilliseconds: cutoff === 'request' ? 50 : 1000, activeUntil: now + (cutoff === 'active' ? 50 : 3000), observationDeadline: now + 3000, maxObservations: 1 });
   assert.ok(signal, 'target request dispatched'); assert.equal(signal.aborted, true, 'local fetch signal must be aborted');
   assert.deepEqual(calls, ['submit', 'observe', 'retrieve'].slice(0, ['submit', 'observe', 'retrieve'].indexOf(stage) + 1));
   const stopped = state.readTraversal(); assert.ok(stopped.gaps.length); assert.equal(stopped.candidates.length, 0);
   if (stage !== 'submit') assert.equal(stopped.attempts[0].knownId, 'id');
   pending.resolve(new Response(JSON.stringify(stage === 'submit' ? { snapshot_id: 'late' } : stage === 'observe' ? { status: 'ready' } : [{ name: 'Late', place_id: 'late' }]), { status: stage === 'submit' ? 202 : 200 }));
   await new Promise(resolve => setImmediate(resolve));
   assert.deepEqual(state.readTraversal(), stopped); assert.equal(calls.length, ['submit', 'observe', 'retrieve'].indexOf(stage) + 1);
  } finally { state?.close(); rmSync(dir, { recursive: true, force: true }); }
 });
}

test('positive control: candidate fetch completes and expands before deadlines', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'deadline-positive-')); const path = join(dir, 'state.db'); let state;
 try {
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 2, submissions: 2, activeTime: 10000 }));
  state = DurableState.openBound(path, binding); let sends = 0;
  const transport = createBrightDataHttpCandidate('synthetic', 1000, async (url, init) => {
   const body = init.method === 'POST' ? { snapshot_id: `id${++sends}` } : url.includes('/progress/') ? { status: 'ready' } : sends === 1 ? [{ name: 'Synthetic', place_id: 'p' }] : [];
   return new Response(JSON.stringify(body), { status: init.method === 'POST' ? 202 : 200 });
  });
  const now = Date.now(); await runSyntheticBrightData(state, transport, { requestMilliseconds: 1000, activeUntil: now + 5000, observationDeadline: now + 5000, maxObservations: 1 });
  assert.equal(sends, 2); assert.equal(state.readTraversal().candidates[0].id, 'p');
 } finally { state?.close(); rmSync(dir, { recursive: true, force: true }); }
});
