import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { submitDurableBrightData, observeDurableBrightData } from '../dist/durable-bright-data-submission.js';

const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
const bounds = () => ({ requestMilliseconds: 1000, activeUntil: Date.now() + 10000 });
async function setup(run) {
  const dir = mkdtempSync(join(tmpdir(), 'observe-provider-')); const path = join(dir, 'state.db');
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 5, submissions: 5, activeTime: 10000 }));
  let state = DurableState.openBound(path, binding);
  try {
    await submitDurableBrightData(state, { submit: async () => ({ status: 202, body: { snapshot_id: 'stored-id' } }) }, bounds());
    await run(state, path, () => { state.close(); state = DurableState.openBound(path, binding); return state; });
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
}
test('observes the SQLite ID then separately retrieves and durably expands below-cap results', async () => setup(async (state, path) => {
  assert.equal(state.readTraversal().attempts.at(-1).knownId, 'stored-id'); // positive submission control
  let calls = 0, retrieves = 0;
  await observeDurableBrightData(state, { observe: async id => {
    calls++; const db = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload).attempts.at(-1).knownId, id); } finally { db.close(); }
    return { status: 200, body: { status: 'ready' } };
  }, retrieve: async id => { retrieves++; assert.equal(id, 'stored-id'); return { status: 200, body: [{ name: 'Synthetic', place_id: 'p1' }] }; } }, { ...bounds(), maxObservations: 2, observationDeadline: Date.now() + 5000 });
  assert.equal(calls, 1); assert.equal(retrieves, 1);
  assert.equal(state.readTraversal().cells['0,0'].outcome, 'nonempty');
  assert.equal(state.readTraversal().candidates.length, 1); assert.ok(state.readTraversal().queue.length > 0);
}));
test('cutoff known ID resumes after reopen and budget increase without submission', async () => setup(async (state, path, reopen) => {
  let now = 0, observes = 0, retrieves = 0, submits = 0;
  const pending = Promise.withResolvers();
  const transport = { submit: async () => { submits++; throw Error('resubmit'); }, observe: async id => { observes++; assert.equal(id, 'stored-id'); now = 15; return pending.promise; }, retrieve: async () => { retrieves++; throw Error('early retrieval'); } };
  state.transitionTraversal(s => ({ ...s, activeTime: 0, limits: { ...s.limits, activeTime: 10 } }));
  await observeDurableBrightData(state, transport, { ...bounds(), maxObservations: 1, observationDeadline: Date.now() + 5000 }, { monotonicNow: () => now });
  let stopped = state.readTraversal();
  assert.equal(stopped.activeTime, 15); assert.equal(stopped.activeInterval, false);
  assert.equal(stopped.attempts.at(-1).knownId, 'stored-id'); assert.equal(stopped.attempts.at(-1).observationDisposition, 'stopped');
  assert.ok(stopped.gaps.some(g => g.status === 'unresolved')); assert.equal(retrieves, 0);
  pending.resolve({ status: 200, body: { status: 'ready' } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.readTraversal().candidates.length, 0); assert.equal(state.readTraversal().queue.length, 0);
  const reopened = reopen();
  assert.throws(() => DurableState.openBound(path, { ...binding, keyword: 'other' }));
  {
    assert.equal(reopened.readTraversal().recoveryPending, false);
    await assert.rejects(observeDurableBrightData(reopened, transport, { ...bounds(), maxObservations: 1, observationDeadline: Date.now() + 5000 }, { monotonicNow: () => now }));
    assert.equal(observes, 1); assert.equal(retrieves, 0); assert.equal(submits, 0);
    reopened.transitionTraversal(s => ({ ...s, limits: { ...s.limits, activeTime: 100 } }));
    await observeDurableBrightData(reopened, { observe: async id => { observes++; assert.equal(id, 'stored-id'); return { status: 200, body: { status: 'ready' } }; }, retrieve: async id => { retrieves++; assert.equal(id, 'stored-id'); return { status: 200, body: [{ name: 'Recovered', place_id: 'recovered' }] }; } }, { ...bounds(), maxObservations: 1, observationDeadline: Date.now() + 5000 }, { monotonicNow: () => now });
    assert.equal(submits, 0); assert.equal(observes, 2); assert.equal(retrieves, 1);
    assert.equal(reopened.readTraversal().candidates[0].id, 'recovered'); assert.equal(reopened.readTraversal().cells['0,0'].outcome, 'nonempty');
  }
}));

test('observation exhaustion parks durable ID with gap and no retrieval', async () => setup(async state => {
  let calls = 0;
  await observeDurableBrightData(state, { observe: async () => { calls++; return { status: 200, body: { status: 'running' } }; }, retrieve: async () => { throw Error('unexpected retrieval'); } }, { ...bounds(), maxObservations: 2, observationDeadline: Date.now() + 5000 });
  assert.equal(calls, 2); const s = state.readTraversal(); assert.equal(s.attempts.at(-1).knownId, 'stored-id'); assert.equal(s.attempts.at(-1).status, 'uncertain'); assert.ok(s.gaps.some(g => g.status === 'unresolved'));
}));
