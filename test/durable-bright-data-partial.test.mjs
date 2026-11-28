import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { status, exportResults } from '../dist/operator.js';
import { runSyntheticOperator } from '../dist/synthetic-bright-data-operator.js';
import { createTraversal } from '../dist/traversal.js';
import { submitDurableBrightData, observeDurableBrightData } from '../dist/durable-bright-data-submission.js';

for (const [label, records] of [
  ['at cap', [{ name: 'One', place_id: 'p1', lat: 51, lon: -1 }, { name: 'Two', place_id: 'p2' }]],
  ['mixed errors', [{ name: 'One', place_id: 'p1', lat: 51, lon: -1 }, { error: 'synthetic error' }]],
]) test(`durably retains ${label} candidates without expansion`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'partial-')); const path = join(dir, 'state.db');
  const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: label === 'at cap' ? 2 : 10 };
  const bounds = () => ({ requestMilliseconds: 1000, activeUntil: Date.now() + 10000 });
  let state;
  try {
    DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 5, submissions: 5, activeTime: 10000 }));
    state = DurableState.openBound(path, binding);
    await submitDurableBrightData(state, { submit: async () => ({ status: 202, body: { snapshot_id: 'id' } }) }, bounds());
    await observeDurableBrightData(state, { observe: async () => ({ status: 200, body: { status: 'ready' } }), retrieve: async () => ({ status: 200, body: records }) }, { ...bounds(), maxObservations: 1, observationDeadline: Date.now() + 5000 });
    state.close(); state = undefined;
    const db = new DatabaseSync(path, { readOnly: true });
    let raw; try { raw = JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); } finally { db.close(); }
    state = DurableState.openBound(path, binding); const s = state.readTraversal();
    assert.deepEqual(s, raw);
    assert.equal(s.cells['0,0'].outcome, 'partial');
    assert.deepEqual(s.queue, []); assert.equal(s.admitted.length, 1);
    assert.ok(s.gaps.some(g => g.cause === 'partial' && g.status === 'unresolved'));
    assert.deepEqual(s.candidates.map(c => [c.id, c.name]), records.filter(r => r.place_id).map(r => [r.place_id, r.name]));
    assert.deepEqual(s.candidates.map(c => c.occurrence), records.filter(r => r.place_id).map((_, index) => index + 1));
    for (const [index, c] of s.candidates.entries()) {
      const record = records.filter(r => r.place_id)[index];
      assert.deepEqual(c.coordinate, record.lat === undefined ? undefined : { latitude: record.lat, longitude: record.lon });
      assert.equal(c.sourceCell, '0,0');
      assert.equal(c.attemptId, s.attempts[0].id);
      assert.equal(c.observationId, `${s.attempts[0].id}:observation:${index + 1}`);
      assert.ok(s.detailWork.some(w => w.status === 'pending' && w.observationIds.includes(c.observationId)));
    }
    state.close(); state = undefined;
    const inspected = status({ checkpoint: path });
    assert.ok(inspected.discoveryGaps.some(gap => gap.cause === 'partial'));
    const v2 = exportResults({ checkpoint: path, format: 'v2' });
    assert.deepEqual(v2.status, inspected);
    assert.deepEqual(v2.unverifiedObservations.map(item => [item.candidateId, item.name, item.sourceCell, item.attemptId, item.observationId, item.occurrence, item.detailState]), s.candidates.map(item => [item.id, item.name, item.sourceCell, item.attemptId, item.observationId, item.occurrence, 'not_attempted']));
    let calls = 0;
    const noReplay = async () => { calls++; throw new Error('unexpected provider request'); };
    await runSyntheticOperator('resume', { checkpoint: path, geometry: s.geometry, binding, limits: { cells: 6, submissions: 6 }, bounds: { ...bounds(), maxObservations: 1, observationDeadline: Date.now() + 5000 } }, { submit: noReplay, observe: noReplay, retrieve: noReplay });
    assert.equal(calls, 0);
    const after = exportResults({ checkpoint: path, format: 'v2' });
    assert.deepEqual(after.unverifiedObservations, v2.unverifiedObservations);
    assert.deepEqual(after.status.discoveryGaps, v2.status.discoveryGaps);
    state = DurableState.openBound(path, binding);
    assert.equal(state.readTraversal().cells['0,0'].outcome, 'partial');
  } finally { state?.close(); rmSync(dir, { recursive: true, force: true }); }
});
