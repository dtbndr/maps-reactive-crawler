import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTraversal, validateGeometry, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { exportResults } from '../dist/operator.js';
import { projectV2Checkpoint } from '../dist/operator-v2-projection-internal.js';

function fixture(fn, candidates = [
  { id: 'same', name: 'First', coordinate: { latitude: 0, longitude: 0 }, verifiedCanonicalKey: 'place:a' },
  { id: 'same', verifiedCanonicalKey: 'place:a' },
  { id: 'same', name: 'Third', coordinate: null },
  { id: 'same' },
  { id: 'other', verifiedCanonicalKey: 'place:Z' },
]) {
  const dir = mkdtempSync(join(tmpdir(), 'projection-'));
  const checkpoint = join(dir, 'state.db');
  try {
    let state = createTraversal(validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } }), { cells: 5, submissions: 1, activeTime: 100 });
    const key = state.queue[0];
    state = reserveSubmission(admitNextCell(state), key);
    state = { ...state, attempts: state.attempts.map(a => ({ ...a, status: 'dispatched', knownId: 'synthetic' })) };
    state = observeKnownId(state, key, 'synthetic', 0);
    state = applyDiscoveryResult(state, key, { status: 'success', candidates });
    DurableState.createBound(checkpoint, 'a'.repeat(64), state);
    fn({ checkpoint, state });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('v2 projects stored fields, identity, provenance and work association', () => fixture(({ checkpoint, state }) => {
  const result = projectV2Checkpoint({ checkpoint });
  const candidate = state.candidates[0];
  assert.deepEqual(result, {
    version: 2, status: exportResults({ checkpoint }).status,
    verifiedPlaces: [
      { canonicalKey: 'place:Z', observations: [occurrence(state.candidates[4], state)] },
      { canonicalKey: 'place:a', observations: [occurrence(candidate, state), occurrence(state.candidates[1], state)] },
    ],
    unverifiedObservations: [occurrence(state.candidates[2], state), occurrence(state.candidates[3], state)],
  });
  assert.deepEqual(projectV2Checkpoint({ checkpoint }), result);
}));

function occurrence(c, state, detailState = 'not_attempted') {
  return { candidateId: c.id, name: c.name ?? null, coordinate: c.coordinate ?? null, classification: c.classification,
    fieldStatus: { name: c.name == null ? 'not_present' : 'present', coordinate: c.coordinate == null ? 'not_present' : 'present' }, detailState,
    sourceCell: c.sourceCell, workId: state.attempts.find(a => a.id === c.attemptId).workId, attemptId: c.attemptId, observationId: c.observationId, occurrence: c.occurrence };
}

test('legacy absent detail work yields unknown without changing checkpoint', () => fixture(({ checkpoint, state }) => {
  const durable = DurableState.openBound(checkpoint, 'a'.repeat(64)); delete state.detailWork; durable.writeTraversal(state); durable.close();
  const before = readFileSync(checkpoint);
  const result = projectV2Checkpoint({ checkpoint });
  assert.notEqual(result, null);
  assert.equal(result.unverifiedObservations[0].detailState, 'unknown');
  assert.deepEqual(readFileSync(checkpoint), before);
}));

test('projects every persisted work status by observation membership', () => fixture(({ checkpoint, state }) => {
  for (const status of ['pending', 'reserved', 'dispatched', 'uncertain', 'completed', 'skipped']) {
    const work = state.detailWork[0];
    work.status = status;
    work.attempts = status === 'pending' ? [] : [{ id: `${work.id}:attempt:1`, status, ...(status === 'completed' ? { knownId: 'synthetic-detail' } : {}) }];
    state.submissions = state.attempts.length + work.attempts.length;
    state.limits.submissions = 3;
    const durable = DurableState.openBound(checkpoint, 'a'.repeat(64)); durable.writeTraversal(state); durable.close();
    const result = projectV2Checkpoint({ checkpoint });
    assert.deepEqual(result.verifiedPlaces[1].observations.map(c => c.detailState), [status === 'pending' ? 'not_attempted' : status, status === 'pending' ? 'not_attempted' : status]);
    assert.deepEqual(result.unverifiedObservations.map(c => c.detailState), ['not_attempted', 'not_attempted']);
  }
}));

test('owner metadata is identical to v1 and inspection remains read-only', () => fixture(({ checkpoint }) => {
  for (const pid of [process.pid, 2147483647]) {
    const db = new DatabaseSync(checkpoint);
    db.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(pid); db.close();
    const before = readFileSync(checkpoint);
    assert.deepEqual(projectV2Checkpoint({ checkpoint }).status, exportResults({ checkpoint }).status);
    assert.equal(projectV2Checkpoint({ checkpoint }).status.state, 'potentially_interrupted');
    assert.deepEqual(readFileSync(checkpoint), before);
  }
}));

test('invalid or unsupported checkpoints fail closed without repair', () => fixture(({ checkpoint, state }) => {
  const db = new DatabaseSync(checkpoint);
  const update = db.prepare('UPDATE traversal SET payload = ? WHERE id = 1');
  const original = JSON.stringify(state);
  for (const mutate of [
    s => { s.detailWork[0].observationIds.pop(); },
    s => { s.detailWork[0].observationIds.push(s.detailWork[0].observationIds[0]); },
  ]) {
    const corrupt = structuredClone(state); mutate(corrupt); update.run(JSON.stringify(corrupt));
    assert.throws(() => projectV2Checkpoint({ checkpoint }));
    assert.equal(db.prepare('SELECT payload FROM traversal WHERE id = 1').get().payload, JSON.stringify(corrupt));
    update.run(original);
  }
  db.prepare('UPDATE checkpoint SET version=99 WHERE id=1').run();
  assert.throws(() => projectV2Checkpoint({ checkpoint }));
  assert.equal(db.prepare('SELECT version FROM checkpoint WHERE id=1').get().version, 99);
  db.close();
}));

test('status retains overlapping detail-origin and detail gaps', () => fixture(({ checkpoint, state }) => {
  const work = state.detailWork[0];
  work.status = 'uncertain';
  work.attempts = [{ id: `${work.id}:attempt:1`, status: 'uncertain' }];
  state.submissions++; state.limits.submissions++;
  const gapId = `detail-origin:${work.id}`;
  state.gaps.push({ id: gapId, cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' });
  state.detailOriginBlockers = [{ workId: work.id, cellKey: '0,0', gapId, status: 'unresolved' }];
  state.detailGaps = [{ workId: work.id, identity: work.identity, observationIds: [...work.observationIds], status: 'unresolved' }];
  const durable = DurableState.openBound(checkpoint, 'a'.repeat(64)); durable.writeTraversal(state); durable.close();
  const result = projectV2Checkpoint({ checkpoint });
  assert.deepEqual(result.status, exportResults({ checkpoint }).status);
  assert.equal(result.status.discoveryGaps[0].id, gapId);
  assert.equal(result.status.detailGaps[0].workId, work.id);
}));

test('ordering follows code units independently of checkpoint order', () => fixture(({ checkpoint, state }) => {
  state.candidates.reverse();
  const durable = DurableState.openBound(checkpoint, 'a'.repeat(64)); durable.writeTraversal(state); durable.close();
  const result = projectV2Checkpoint({ checkpoint });
  assert.deepEqual(result.verifiedPlaces.map(p => p.canonicalKey), ['place:Z', 'place:a']);
  assert.deepEqual(result.verifiedPlaces[1].observations.map(o => o.occurrence), [1, 2]);
  assert.deepEqual(result.unverifiedObservations.map(o => o.occurrence), [3, 4]);
  assert.deepEqual(projectV2Checkpoint({ checkpoint }), result);
}));

test('duplicate unverified candidate IDs use their own observation work status', () => fixture(({ checkpoint, state }) => {
  const [first, second] = state.candidates.slice(2, 4);
  assert.equal(first.id, second.id);
  assert.notEqual(first.observationId, second.observationId);
  const work = state.detailWork.find(item => item.observationIds.includes(second.observationId));
  work.status = 'completed';
  work.attempts = [{ id: `${work.id}:attempt:1`, status: 'completed', knownId: 'synthetic-detail' }];
  state.submissions++; state.limits.submissions++;
  const durable = DurableState.openBound(checkpoint, 'a'.repeat(64)); durable.writeTraversal(state); durable.close();
  assert.deepEqual(projectV2Checkpoint({ checkpoint }).unverifiedObservations.map(({ observationId, detailState }) => ({ observationId, detailState })), [
    { observationId: first.observationId, detailState: 'not_attempted' },
    { observationId: second.observationId, detailState: 'completed' },
  ]);
}));

test('both observation collections use lexical IDs rather than numeric ordinals', () => fixture(({ checkpoint, state }) => {
  const result = projectV2Checkpoint({ checkpoint });
  const verified = result.verifiedPlaces[0].observations;
  const unverified = result.unverifiedObservations;
  assert.deepEqual(verified.map(o => o.occurrence), [1, 11, 3, 5, 7, 9]);
  assert.deepEqual(unverified.map(o => o.occurrence), [10, 12, 2, 4, 6, 8]);
  assert.deepEqual(verified.map(o => o.observationId), [1, 11, 3, 5, 7, 9].map(n => state.candidates[n - 1].observationId));
  assert.deepEqual(unverified.map(o => o.observationId), [10, 12, 2, 4, 6, 8].map(n => state.candidates[n - 1].observationId));
}, Array.from({ length: 12 }, (_, index) => index % 2 === 0
  ? { id: 'same', verifiedCanonicalKey: 'place:shared' }
  : { id: 'same' })));
