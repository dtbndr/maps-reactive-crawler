import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, dispatchSubmission, debitActiveTime, observeKnownId, applyDiscoveryResult, reportTraversal, isCellEligible } from '../dist/index.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });

// Script entries describe elapsed time and a synthetic response; the driver makes no scheduling decisions.
function runFixture({ limits, script }) {
  let state = createTraversal(geometry, limits);
  let index = 0;
  while (index < script.length && state.queue.length) {
    const report = reportTraversal(state);
    if (report.stopReason === 'submissions' || report.stopReason === 'active_time' || report.stopReason === 'paused' || (report.stopReason === 'cells' && report.queue.length === 0)) break;
    const entry = script[index++];
    const key = state.queue[0];
    state = admitNextCell(state);
    state = dispatchSubmission(reserveSubmission(state, key), key);
    state = debitActiveTime(state, entry.elapsed);
    if (entry.observation) state = observeKnownId(state, key, entry.observation, entry.observationElapsed);
    if (entry.result) state = applyDiscoveryResult(state, key, entry.result);
    else break;
  }
  return { ...reportTraversal(state), candidates: state.candidates, consumedResponses: index, admitted: [...state.admitted] };
}

test('serial fixture expands raw nonempty results and deterministically stops at cell cap', () => {
  const input = { limits: { cells: 2, submissions: 4, activeTime: 20 }, script: [
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'raw-a' }] } },
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'raw-b' }] } },
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'unused' }] } },
  ] };
  const first = runFixture(input);
  assert.deepEqual(runFixture(input), first);
  assert.equal(first.cells['0,0'].outcome, 'nonempty');
  assert.equal(Object.keys(first.cells).length, 2);
  assert.equal(first.stopReason, 'cells');
  assert.equal(first.submissions, 2);
  assert.deepEqual(first.queue, []);
  assert.ok(first.blocked.length > 0);
  assert.ok(first.cells['0,1'] || first.cells['0,-1'] || first.cells['1,0'] || first.cells['-1,0']);
  assert.deepEqual(first.queue, [], 'connected traversal only; this does not prove exhaustive coverage');
  assert.equal(first.cells['0,1'].outcome, 'nonempty', 'the exact north neighbor completed');
  assert.equal(isCellEligible(geometry, 100, 100), true);
  assert.equal(first.cells['100,100'], undefined, 'an eligible disconnected cell remains unvisited');
});

test('active-time exhaustion after a nonempty response is not attributed to the cell cap', () => {
  const result = runFixture({ limits: { cells: 8, submissions: 8, activeTime: 1 }, script: [
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'seed' }] } },
  ] });
  assert.equal(result.stopReason, 'active_time');
  assert.ok(result.blocked.length > 0);
  assert.equal(result.consumedResponses, 1);
});

test('global pause with queued siblings returns without consuming an unused response', () => {
  const result = runFixture({ limits: { cells: 8, submissions: 8, activeTime: 20 }, script: [
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'seed' }] } },
    { elapsed: 1, result: { status: 'failed', scope: 'global' } },
    { elapsed: 1, result: { status: 'empty' } },
  ] });
  assert.equal(result.stopReason, 'paused');
  assert.equal(result.consumedResponses, 2);
  assert.ok(result.queue.length > 0);
});

test('fixture retains inside, outside, and unverified candidate classifications', () => {
  const result = runFixture({ limits: { cells: 1, submissions: 1, activeTime: 20 }, script: [{ elapsed: 1, result: { status: 'success', candidates: [
    { id: 'inside', coordinate: { latitude: 0, longitude: 0 } },
    { id: 'outside', coordinate: { latitude: 2, longitude: 2 } },
    { id: 'unverified', coordinate: null },
  ] } }] });
  assert.deepEqual(result.candidates.map(candidate => candidate.classification), ['inside', 'outside', 'unverified']);
});

test('empty frontier exhausts without budget stop while eligible disconnected cell remains unvisited', () => {
  const result = runFixture({ limits: { cells: 100, submissions: 100, activeTime: 100 }, script: [
    { elapsed: 1, result: { status: 'empty' } },
  ] });
  assert.equal(result.stopReason, 'empty');
  assert.equal(result.outcome, 'partial_empty_success');
  assert.deepEqual(result.queue, []);
  assert.equal(result.consumedResponses, 1);
  assert.equal(result.submissions, 1);
  assert.ok(result.admitted.length < 100);
  assert.equal(isCellEligible(geometry, 100, 100), true);
  assert.equal(result.cells['100,100'], undefined, 'eligible location beyond empty frontier is unvisited without a budget stop');
});

test('empty and failure remain distinct and neither expands', () => {
  const base = { cells: 8, submissions: 8, activeTime: 20 };
  const empty = runFixture({ limits: base, script: [{ elapsed: 1, result: { status: 'empty' } }] });
  const failed = runFixture({ limits: base, script: [{ elapsed: 1, result: { status: 'failed', scope: 'isolated' } }] });
  assert.equal(empty.cells['0,0'].outcome, 'empty');
  assert.equal(empty.stopReason, 'empty');
  assert.equal(failed.cells['0,0'].outcome, 'failed');
  assert.equal(failed.stopReason, 'gaps');
});

test('duplicate-only results still expand; submission and active-time caps remain independent', () => {
  const duplicate = runFixture({ limits: { cells: 6, submissions: 8, activeTime: 20 }, script: [
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'same' }] } },
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'same' }, { id: 'same' }] } },
    { elapsed: 1, result: { status: 'empty' } },
  ] });
  assert.equal(duplicate.cells['0,0'].outcome, 'nonempty');
  assert.ok(Object.values(duplicate.cells).some(cell => cell.outcome === 'nonempty'));
  assert.equal(Object.values(duplicate.cells).filter(cell => cell.outcome === 'nonempty').length, 2);
  assert.equal(duplicate.cells['0,2'].outcome, 'queued', 'duplicate-only north response adds its new north neighbor beyond the seed frontier');
  const submission = runFixture({ limits: { cells: 8, submissions: 1, activeTime: 20 }, script: [
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'x' }] } },
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'unused' }] } },
  ] });
  assert.equal(submission.stopReason, 'submissions');
  assert.equal(submission.consumedResponses, 1);
  assert.equal(submission.submissions, 1);
  assert.equal(submission.cells['0,1'].outcome, 'queued');
  const time = runFixture({ limits: { cells: 8, submissions: 8, activeTime: 1 }, script: [
    { elapsed: 0, result: { status: 'success', candidates: [{ id: 'seed' }] } },
    { elapsed: 1, observation: 'job-1', observationElapsed: 1, result: { status: 'empty' } },
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'unused' }] } },
  ] });
  assert.equal(time.activeTime, 2);
  assert.equal(time.stopReason, 'active_time');
  assert.equal(time.submissions, 2);
  assert.equal(time.consumedResponses, 2);
  assert.equal(time.cells['0,1'].outcome, 'empty', 'the observed north cell receives its final result');
});
