import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';
import { completeDetailWork } from '../dist/traversal.js';
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

test('verified detail completion without an origin blocker preserves untagged discovery gaps', () => {
  const { state: discoveredState, key } = discovered([{ id: 'one', verifiedCanonicalKey: 'place:one' }]);
  const work = discoveredState.detailWork[0];
  const state = {
    ...discoveredState,
    detailWork: [{ ...work, status: 'dispatched', attempts: [{ id: `${work.id}:attempt:1`, status: 'dispatched', knownId: 'detail-id' }] }],
    gaps: [{ cellKey: key, cause: 'uncertain', scope: 'global', status: 'unresolved' }],
  };
  const completed = completeDetailWork(state, work.id, 'detail-id');
  assert.deepEqual(completed.gaps, state.gaps);
});

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
  const { state: current } = discovered([{ id: 'next' }]);
  const prior = structuredClone(current);
  const legacy = { ...current, detailWork: undefined, candidates: [
    { ...current.candidates[0], observationId: 'legacy:1', attemptId: current.attempts[0].id, verifiedCanonicalKey: 'place:legacy' },
    { ...current.candidates[0], observationId: 'legacy:2', attemptId: current.attempts[0].id, verifiedCanonicalKey: 'place:legacy' },
    { ...current.candidates[0], observationId: 'legacy:3', attemptId: current.attempts[0].id },
  ], limits: { ...current.limits, submissions: 2 } };
  const newKey = legacy.queue[0];
  let pending = reserveSubmission(admitNextCell(legacy), newKey);
  const newAttemptId = pending.attempts.at(-1).id;
  pending = { ...pending, attempts: pending.attempts.map(attempt => attempt.id === newAttemptId ? { ...attempt, status: 'dispatched', knownId: 'new-results' } : attempt) };
  pending = observeKnownId(pending, newKey, 'new-results', 0);
  const original = structuredClone(pending);
  const empty = applyDiscoveryResult(pending, newKey, { status: 'empty' });
  assert.deepEqual(pending, original);
  assert.deepEqual(empty.detailWork.map(work => [work.id, work.observationIds]), [
    ['detail:verified:place:legacy', ['legacy:1', 'legacy:2']], ['detail:observation:legacy:3', ['legacy:3']],
  ]);
  const nonemptyInput = pending;
  const nonemptyBefore = structuredClone(nonemptyInput);
  const nonempty = applyDiscoveryResult(nonemptyInput, newKey, { status: 'success', candidates: [{ id: 'new' }] });
  assert.deepEqual(nonemptyInput, nonemptyBefore);
  assert.equal(nonempty.detailWork.length, 3);
  assert.deepEqual(nonempty.detailWork.map(work => [work.id, work.observationIds]), [
    ['detail:verified:place:legacy', ['legacy:1', 'legacy:2']],
    ['detail:observation:legacy:3', ['legacy:3']],
    [`detail:observation:${newAttemptId}:observation:1`, [`${newAttemptId}:observation:1`]],
  ]);
  assert.equal(nonempty.candidates.at(-1).sourceCell, newKey);
  const dir = mkdtempSync(join(tmpdir(), 'durable-identity-'));
  try {
    const durable = DurableState.open(join(dir, 'state.db'));
    durable.writeTraversal(nonempty);
    assert.deepEqual(durable.readTraversal(), nonempty);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
    const verified = discovered([
      { id: 'one', verifiedCanonicalKey: 'canonical:shared' },
      { id: 'two', verifiedCanonicalKey: 'canonical:shared' },
    ]).state;
    const [firstObservation, secondObservation] = verified.detailWork[0].observationIds;
    const forgedMultipleRows = {
      ...verified,
      detailWork: [
        { ...verified.detailWork[0], observationIds: [firstObservation] },
        { ...verified.detailWork[0], id: 'detail:forged-second', observationIds: [secondObservation] },
      ],
    };
    const malformedId = {
      ...verified,
      detailWork: [{ ...verified.detailWork[0], id: 'not-the-deterministic-id' }],
    };
    for (const corrupted of [...corruptions, forgedMultipleRows, malformedId]) assert.throws(() => durable.writeTraversal(corrupted), /Corrupt traversal checkpoint/);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
