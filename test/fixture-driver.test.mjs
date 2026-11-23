import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, dispatchSubmission, debitActiveTime, observeKnownId, applyDiscoveryResult, reportTraversal } from '../dist/index.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });

// Script entries describe elapsed time and a synthetic response; the driver makes no scheduling decisions.
function runFixture({ limits, script }) {
  let state = createTraversal(geometry, limits);
  let index = 0;
  while (index < script.length && state.queue.length) {
    const entry = script[index++];
    const key = state.queue[0];
    state = admitNextCell(state);
    state = dispatchSubmission(reserveSubmission(state, key), key);
    state = debitActiveTime(state, entry.elapsed);
    if (entry.observation) state = observeKnownId(state, key, entry.observation, entry.observationElapsed);
    if (entry.result) state = applyDiscoveryResult(state, key, entry.result);
    else break;
  }
  return reportTraversal(state);
}

test('serial fixture expands raw nonempty results and deterministically stops at cell cap', () => {
  const input = { limits: { cells: 2, submissions: 4, activeTime: 20 }, script: [
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'raw-a' }] } },
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'raw-b' }] } },
  ] };
  const first = runFixture(input);
  assert.deepEqual(runFixture(input), first);
  assert.equal(first.cells['0,0'].outcome, 'nonempty');
  assert.equal(Object.keys(first.cells).length, 2);
  assert.equal(first.stopReason, 'cells');
  assert.equal(first.submissions, 2);
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
  const duplicate = runFixture({ limits: { cells: 2, submissions: 8, activeTime: 20 }, script: [
    { elapsed: 1, result: { status: 'success', candidates: [{ id: 'same' }, { id: 'same' }] } },
  ] });
  assert.equal(duplicate.cells['0,0'].outcome, 'nonempty');
  const submission = runFixture({ limits: { cells: 8, submissions: 1, activeTime: 20 }, script: [{ elapsed: 1, result: { status: 'success', candidates: [{ id: 'x' }] } }] });
  assert.equal(submission.stopReason, 'submissions');
  const time = runFixture({ limits: { cells: 8, submissions: 8, activeTime: 1 }, script: [
    { elapsed: 0, result: { status: 'success', candidates: [{ id: 'seed' }] } },
    { elapsed: 1, observation: 'job-1', observationElapsed: 1, result: { status: 'empty' } },
  ] });
  assert.equal(time.activeTime, 2);
  assert.equal(time.stopReason, 'active_time');
  assert.equal(time.submissions, 2);
});
