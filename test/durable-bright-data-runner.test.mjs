import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal, markUncertain } from '../dist/traversal.js';
import { submitDurableBrightData, runSyntheticBrightData } from '../dist/durable-bright-data-submission.js';

const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
const bounds = () => ({ requestMilliseconds: 1000, activeUntil: Date.now() + 10000, maxObservations: 1, observationDeadline: Date.now() + 10000 });
test('connected runner dispatches seed and expanded neighbor with durable IDs', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'runner-')); const path = join(dir, 'state.db');
 try {
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 2, submissions: 2, activeTime: 10000 }));
  const state = DurableState.openBound(path, binding); const requests = [];
  const checkpoint = () => { const db = new DatabaseSync(path, { readOnly: true }); try { return JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); } finally { db.close(); } };
  try {
   const result = await runSyntheticBrightData(state, {
    submit: async request => { const a = checkpoint().attempts.at(-1); assert.equal(a.status, 'dispatched'); requests.push(request.body.input[0]); return { status: 202, body: { snapshot_id: `id-${requests.length}` } }; },
    observe: async id => { assert.equal(checkpoint().attempts.at(-1).knownId, id); return { status: 200, body: { status: 'ready' } }; },
    retrieve: async id => ({ status: 200, body: id === 'id-1' ? [{ name: 'Synthetic', place_id: 'one' }] : [] }),
   }, bounds());
   assert.equal(requests.length, 2); assert.equal(requests[0].lat, 51); assert.notEqual(requests[1].lat, 51); assert.equal(requests[1].long, -1);
   assert.equal(state.readTraversal().candidates[0].id, 'one'); assert.ok(result.reason);
  } finally { state.close(); }
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('runner cutoff isolates late observation and resumes its ID after budget increase', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'runner-cutoff-')); const path = join(dir, 'state.db');
 let state;
 try {
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 2, submissions: 2, activeTime: 80 }));
  state = DurableState.openBound(path, binding);
  let sends = 0, observes = 0, retrieves = 0, now = 0, beforeObservation;
  const pending = Promise.withResolvers();
  const clock = { monotonicNow: () => now };
  const transport = {
   submit: async () => { sends++; return { status: 202, body: { snapshot_id: 'cutoff-id' } }; },
   observe: async id => { observes++; assert.equal(id, 'cutoff-id'); beforeObservation = state.readTraversal().activeTime; now = 120; return pending.promise; },
   retrieve: async () => { retrieves++; return { status: 200, body: [{ name: 'Late', place_id: 'late' }] }; },
  };
  const started = Date.now();
  await runSyntheticBrightData(state, transport, bounds(), clock);
  assert.ok(Date.now() - started < 2000, 'hung observation must be bounded');
  const stopped = state.readTraversal();
  assert.equal(stopped.activeTime, beforeObservation + 120, 'actual elapsed must not be clamped');
  assert.equal(stopped.activeInterval, false); assert.equal(stopped.attempts[0].knownId, 'cutoff-id');
  assert.equal(stopped.attempts[0].observationDisposition, 'stopped');
  assert.ok(stopped.gaps.some(g => g.cause === 'uncertain' && g.status === 'unresolved'));
  assert.equal(sends, 1); assert.equal(observes, 1); assert.equal(retrieves, 0);
  pending.resolve({ status: 200, body: { status: 'ready' } }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.readTraversal(), stopped); assert.equal(retrieves, 0); assert.equal(sends, 1);
  state.close(); state = DurableState.openBound(path, binding);
  assert.equal(state.readTraversal().recoveryPending, false);
  state.transitionTraversal(s => ({ ...s, limits: { ...s.limits, activeTime: 1000 } }));
  await runSyntheticBrightData(state, { ...transport, observe: async id => { observes++; assert.equal(id, 'cutoff-id'); return { status: 200, body: { status: 'ready' } }; }, retrieve: async id => { retrieves++; assert.equal(id, 'cutoff-id'); return { status: 200, body: [] }; } }, bounds(), clock);
  assert.equal(sends, 1); assert.equal(observes, 2); assert.equal(retrieves, 1);
  assert.equal(state.readTraversal().cells['0,0'].outcome, 'empty');
 } finally { state?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('runner reopens known stopped ID without another submission', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'runner-resume-')); const path = join(dir, 'state.db');
 try {
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 1, submissions: 1, activeTime: 10000 }));
  let state = DurableState.openBound(path, binding); let sends = 0;
  const transport = { submit: async () => { sends++; return { status: 202, body: { snapshot_id: 'known' } }; }, observe: async () => new Promise(() => {}), retrieve: async () => { throw Error('unexpected'); } };
  await submitDurableBrightData(state, transport, bounds());
  state.transitionTraversal(s => { const parked = markUncertain(s, '0,0', 'isolated', 'known'); return { ...parked, attempts: parked.attempts.map(a => ({ ...a, observationDisposition: 'stopped' })) }; });
  assert.equal(sends, 1); assert.equal(state.readTraversal().attempts[0].knownId, 'known'); state.close();
  state = DurableState.openBound(path, binding);
  try {
   await runSyntheticBrightData(state, { ...transport, observe: async id => { assert.equal(id, 'known'); return { status: 200, body: { status: 'ready' } }; }, retrieve: async () => ({ status: 200, body: [] }) }, bounds());
   assert.equal(sends, 1); assert.equal(state.readTraversal().cells['0,0'].outcome, 'empty');
  } finally { state.close(); }
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
