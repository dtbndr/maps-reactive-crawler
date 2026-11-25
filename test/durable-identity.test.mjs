import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });

function discovered(candidates) {
  let state = createTraversal(geometry, { cells: 5, submissions: 1, activeTime: 100 });
  const key = state.queue[0];
  state = reserveSubmission(admitNextCell(state), key);
  const attemptId = state.attempts[0].id;
  state = { ...state, attempts: state.attempts.map(attempt => ({ ...attempt, status: 'dispatched', knownId: 'raw-results' })) };
  state = observeKnownId(state, key, 'raw-results', 0);
  return { state: applyDiscoveryResult(state, key, { status: 'success', candidates }), key, attemptId };
}

test('discovery preserves each occurrence, explicit verified identity, and expands duplicate-only results', () => {
  const {state,key,attemptId} = discovered([
    { id: 'same-raw', verifiedCanonicalKey: 'place:verified', coordinate: { latitude: 0, longitude: 0 } },
    { id: 'same-raw', verifiedCanonicalKey: 'place:verified', coordinate: { latitude: 0, longitude: 0.5 } },
    { id: 'same-raw', coordinate: null },
  ]);
  assert.equal(state.candidates.length, 3);
  assert.deepEqual(state.candidates.map(item => item.verifiedCanonicalKey), ['place:verified', 'place:verified', undefined]);
  assert.deepEqual(state.candidates.map(item => item.occurrence), [1, 2, 3]);
  assert.ok(state.candidates.every(item => item.attemptId === attemptId && item.sourceCell === key));
  assert.notEqual(state.candidates[0].observationId, state.candidates[1].observationId);
  assert.deepEqual(state.candidates.map(item => item.classification), ['inside', 'inside', 'unverified']);
  assert.equal(state.detailWork.length, 2);
  assert.deepEqual(state.detailWork.map(item => item.observationIds), [[`${attemptId}:observation:1`, `${attemptId}:observation:2`], [`${attemptId}:observation:3`]]);
  assert.ok(state.detailWork.every(item => item.status === 'pending'));
  assert.ok(state.queue.length > 0, 'duplicate-only nonempty discovery still expands');
  const beforeReplay = structuredClone(state);
  assert.throws(() => applyDiscoveryResult(state, key, { status: 'success', candidates: [] }), /Cell is not awaiting a result/);
  assert.deepEqual(state, beforeReplay);
});

test('applying results migrates legacy observations to deterministic detail fanout without mutating input', () => {
  const { state: current, key } = discovered([{ id: 'next' }]);
  const prior = structuredClone(current);
  const legacy = { ...current, detailWork: undefined, candidates: [
    { ...current.candidates[0], observationId: 'legacy:1', attemptId: current.attempts[0].id, verifiedCanonicalKey: 'place:legacy' },
    { ...current.candidates[0], observationId: 'legacy:2', attemptId: current.attempts[0].id, verifiedCanonicalKey: 'place:legacy' },
    { ...current.candidates[0], observationId: 'legacy:3', attemptId: current.attempts[0].id, verifiedCanonicalKey: undefined },
  ], cells: { ...current.cells, [key]: { outcome: 'running' } } };
  const original = structuredClone(legacy);
  const empty = applyDiscoveryResult(legacy, key, { status: 'empty' });
  assert.deepEqual(legacy, original);
  assert.deepEqual(empty.detailWork.map(work => [work.id, work.observationIds]), [
    ['detail:verified:place:legacy', ['legacy:1', 'legacy:2']], ['detail:observation:legacy:3', ['legacy:3']],
  ]);
  const nonemptyInput = { ...legacy, cells: { ...legacy.cells, [key]: { outcome: 'running' } } };
  const nonemptyBefore = structuredClone(nonemptyInput);
  const nonempty = applyDiscoveryResult(nonemptyInput, key, { status: 'success', candidates: [{ id: 'new' }] });
  assert.deepEqual(nonemptyInput, nonemptyBefore);
  assert.equal(nonempty.detailWork.length, 4);
  assert.ok(nonempty.detailWork.some(work => work.identity === `observation:${nonempty.candidates.at(-1).observationId}`));
  assert.deepEqual(current, prior);
});

test('durable checkpoint rejects observation links to unknown attempts or source cells', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durable-identity-'));
  try {
    const durable = DurableState.open(join(dir, 'state.db'));
    let state = createTraversal(geometry, { cells: 2, submissions: 1, activeTime: 10 });
    const key = state.queue[0];
    state = reserveSubmission(admitNextCell(state), key);
    const attempt = state.attempts[0];
    state = { ...state, attempts: [{ ...attempt, status: 'observed', knownId: 'raw' }], candidates: [{ id: 'raw', classification: 'unverified', sourceCell: key, observationId: `${attempt.id}:observation:1`, attemptId: attempt.id, occurrence: 1 }] };
    assert.throws(() => durable.writeTraversal({ ...state, candidates: [{ ...state.candidates[0], attemptId: 'missing' }] }), /Corrupt traversal checkpoint/);
    assert.throws(() => durable.writeTraversal({ ...state, candidates: [{ ...state.candidates[0], sourceCell: '9,9' }] }), /Corrupt traversal checkpoint/);
    const valid = discovered([{ id: 'one', verifiedCanonicalKey: 'canonical:one' }, { id: 'two' }]).state;
    const corruptions = [
      { ...valid, detailWork: [{ ...valid.detailWork[0], observationIds: ['missing'] }, valid.detailWork[1]] },
      { ...valid, detailWork: [{ ...valid.detailWork[0], observationIds: [valid.detailWork[0].observationIds[0], valid.detailWork[0].observationIds[0]] }, valid.detailWork[1]] },
      { ...valid, detailWork: [valid.detailWork[0], { ...valid.detailWork[1], id: valid.detailWork[0].id }] },
      { ...valid, detailWork: [valid.detailWork[0], { ...valid.detailWork[1], identity: valid.detailWork[0].identity }] },
      { ...valid, detailWork: [{ ...valid.detailWork[0], observationIds: [...valid.detailWork[0].observationIds, valid.detailWork[1].observationIds[0]] }, valid.detailWork[1]] },
      { ...valid, detailWork: [{ ...valid.detailWork[0], identity: 'observation:wrong' }, valid.detailWork[1]] },
    ];
    for (const corrupted of corruptions) assert.throws(() => durable.writeTraversal(corrupted), /Corrupt traversal checkpoint/);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
