import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, applyDiscoveryResult, reserveSubmission, dispatchSubmission, markUncertain, debitActiveTime, observeKnownId, cancelTraversal, reportTraversal, skipAttempt, authorizeResend, pauseTraversal, resumeTraversal, updateTraversalLimits } from '../dist/index.js';
const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
const limits = { cells: 2, submissions: 2, activeTime: 10 };

test('bounded traversal requires explicit finite independent limits', () => {
  assert.throws(() => createTraversal(geometry), /limits/i);
  assert.throws(() => createTraversal(geometry, { cells: 2, submissions: Infinity, activeTime: 10 }), /limits/i);
});
test('last submission slot is charged once and uncertain sends cannot be resent', () => {
  let state = admitNextCell(createTraversal(geometry, limits));
  state = reserveSubmission(state, '0,0');
  state = dispatchSubmission(state, '0,0');
  state = markUncertain(state, '0,0');
  assert.equal(state.submissions, 1);
  assert.throws(() => reserveSubmission(state, '0,0'), /outstanding/);
  state = debitActiveTime(state, 11);
  assert.equal(state.activeTime, 11);
});
test('known-ID observation is allowed after time cap and records observation time', () => {
  let state = admitNextCell(createTraversal(geometry, limits));
  state = dispatchSubmission(reserveSubmission(state, '0,0'), '0,0');
  state = observeKnownId(state, '0,0', 'job-1', 12);
  assert.equal(state.activeTime, 12);
  assert.equal(state.submissions, 1);
  assert.equal(reportTraversal(state).outcome, 'partial_limit');
});

test('cancellation preserves uncertain work and reports partial cancellation', () => {
  let state = admitNextCell(createTraversal(geometry, limits));
  state = markUncertain(dispatchSubmission(reserveSubmission(state, '0,0'), '0,0'), '0,0');
  state = cancelTraversal(state);
  assert.throws(() => admitNextCell(state), /cancel/i);
  assert.equal(reportTraversal(state).outcome, 'partial_cancelled');
  assert.equal(state.gaps[0].cause, 'uncertain');
});

test('uncertain attempts require explicit resend authorization or may be skipped with a gap preserved', () => {
  let state = admitNextCell(createTraversal(geometry, limits));
  state = markUncertain(dispatchSubmission(reserveSubmission(state, '0,0'), '0,0'), '0,0');
  state = skipAttempt(state, '0,0');
  assert.equal(state.gaps.length, 1);
  assert.throws(() => reserveSubmission(state, '0,0'), /outstanding|skipped/i);
  let resend = admitNextCell(createTraversal(geometry, limits));
  resend = markUncertain(dispatchSubmission(reserveSubmission(resend, '0,0'), '0,0'), '0,0');
  resend = authorizeResend(resend, '0,0');
  assert.equal(resend.submissions, 2);
});

test('cell cap admits one neighbor, blocks other eligible neighbors, and continues admitted work', () => {
  const caps = { cells: 2, submissions: 10, activeTime: 100 };
  let state = admitNextCell(createTraversal(geometry, caps));
  state = dispatchSubmission(reserveSubmission(state, '0,0'), '0,0');
  state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'seed-result' }] });

  assert.equal(state.admitted.length, 2);
  assert.equal(new Set(state.admitted).size, 2);
  assert.equal(state.queue.length, 1);
  assert.equal(state.blocked.length, 3);
  assert.equal(state.submissions, 1);

  const neighbor = state.queue[0];
  state = admitNextCell(state);
  state = dispatchSubmission(reserveSubmission(state, neighbor), neighbor);
  state = applyDiscoveryResult(state, neighbor, { status: 'empty' });

  const report = reportTraversal(state);
  assert.equal(report.outcome, 'partial_limit');
  assert.equal(report.blocked.length, 3);
  assert.equal(report.queue.length, 0);
  assert.equal(report.submissions, 2);
  assert.deepEqual(state.admitted, ['0,0', neighbor]);
  assert.equal(state.cells[neighbor].outcome, 'empty');
});

for (const [label, secondResult] of [
  ['empty', { status: 'empty' }],
  ['isolated failure', { status: 'failed', scope: 'isolated' }],
  ['uncertain send', null],
]) {
  test(`submission cap=2 accounts for attempt 2 (${label}) and denies attempt 3`, () => {
    const caps = { cells: 10, submissions: 2, activeTime: 100 };
    let state = admitNextCell(createTraversal(geometry, caps));
    state = dispatchSubmission(reserveSubmission(state, '0,0'), '0,0');
    state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'seed-result' }] });
    const firstNext = state.queue[0];

    state = admitNextCell(state);
    state = dispatchSubmission(reserveSubmission(state, firstNext), firstNext);
    assert.equal(state.submissions, 2);
    if (secondResult === null) state = markUncertain(state, firstNext);
    else state = applyDiscoveryResult(state, firstNext, secondResult);

    assert.equal(state.submissions, 2);
    const remaining = secondResult === null ? state.queue : state.queue;
    assert.ok(remaining.length > 0, 'independent seeded neighbors remain queued');
    const nextCell = remaining[0];
    if (secondResult !== null) state = admitNextCell(state);
    assert.throws(() => reserveSubmission(state, secondResult === null ? firstNext : nextCell), /Submission limit reached/);
    if (secondResult === null) {
      assert.equal(state.gaps.filter(g => g.cause === 'uncertain').length, 1);
      assert.equal(state.attempts.filter(a => a.status === 'reserved' || a.status === 'dispatched' || a.status === 'uncertain').length, 2);
      assert.throws(() => authorizeResend(state, firstNext), /Resend limit reached/);
    } else if (secondResult.status === 'failed') {
      assert.equal(state.gaps.at(-1).cause, 'failed');
      assert.equal(state.gaps.at(-1).scope, 'isolated');
    } else assert.equal(state.gaps.length, 0);

    const report = reportTraversal(state);
    assert.equal(report.outcome, 'partial_limit');
    assert.deepEqual(report.queue, secondResult === null ? remaining : remaining.slice(1));
    assert.equal(report.submissions, 2);
    assert.equal(report.gaps.length, secondResult === null || secondResult.status === 'failed' ? 1 : 0);
  });
}

test('active-time cap at equality blocks new work but permits known-ID observation and result application', () => {
  const caps = { cells: 10, submissions: 10, activeTime: 10 };
  let state = admitNextCell(createTraversal(geometry, caps));
  state = dispatchSubmission(reserveSubmission(state, '0,0'), '0,0');
  state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'seed-result' }] });
  const knownCell = state.queue[0];
  state = admitNextCell(state);
  state = dispatchSubmission(reserveSubmission(state, knownCell), knownCell);
  state = debitActiveTime(state, 10);

  assert.throws(() => admitNextCell(state), /Active-time limit/);
  assert.throws(() => reserveSubmission(state, knownCell), /Submission stopped/);
  state = observeKnownId(state, knownCell, 'known-job', 3);
  assert.equal(state.activeTime, 13);
  assert.equal(state.submissions, 2);
  state = applyDiscoveryResult(state, knownCell, { status: 'empty' });
  const report = reportTraversal(state);
  assert.equal(report.outcome, 'partial_limit');
  assert.equal(report.activeTime, 13);
  assert.equal(report.submissions, 2);
  assert.ok(report.queue.length > 0);
});

test('active-time cap reached before dispatch denies reservation', () => {
  const caps = { cells: 2, submissions: 10, activeTime: 10 };
  let state = admitNextCell(createTraversal(geometry, caps));
  state = debitActiveTime(state, 10);
  assert.throws(() => reserveSubmission(state, '0,0'), /Submission stopped/);
  assert.equal(state.submissions, 0);
  assert.equal(state.attempts.length, 0);
  assert.equal(reportTraversal(state).outcome, 'partial_limit');
});

for (const [label, gapResult, expectedOutcome, expectedCause] of [
  ['isolated failure', { status: 'failed', scope: 'isolated' }, 'failed', 'failed'],
  ['unrecognized result', { status: 'unrecognized' }, 'unrecognized', 'unrecognized'],
]) {
  test(`${label} gap remains visible when a later submission cap stops independent work`, () => {
    const caps = { cells: 10, submissions: 3, activeTime: 100 };
    let state = admitNextCell(createTraversal(geometry, caps));
    state = dispatchSubmission(reserveSubmission(state, '0,0'), '0,0');
    state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'seed-result' }] });

    const gapCell = state.queue[0];
    state = admitNextCell(state);
    state = dispatchSubmission(reserveSubmission(state, gapCell), gapCell);
    state = applyDiscoveryResult(state, gapCell, gapResult);

    const independentCell = state.queue[0];
    assert.ok(independentCell);
    state = admitNextCell(state);
    state = dispatchSubmission(reserveSubmission(state, independentCell), independentCell);
    state = applyDiscoveryResult(state, independentCell, { status: 'empty' });

    assert.equal(state.submissions, 3);
    const nextCell = state.queue[0];
    assert.ok(nextCell, 'additional independent work remains queued');
    state = admitNextCell(state);
    assert.throws(() => reserveSubmission(state, nextCell), /Submission limit reached/);

    const report = reportTraversal(state);
    assert.equal(report.outcome, 'partial_limit');
    assert.equal(report.cells[gapCell].outcome, expectedOutcome);
    assert.deepEqual(report.gaps, [{ cellKey: gapCell, cause: expectedCause, ...(expectedCause === 'failed' ? { scope: 'isolated' } : {}) }]);
    assert.equal(report.submissions, 3);
    assert.deepEqual(report.queue, state.queue);
    assert.ok(report.queue.length > 0);
    assert.notEqual(report.outcome, 'complete');
  });
}

test('pause and cap increases preserve cumulative counters and enforce paused transitions', () => {
  const caps = { cells: 2, submissions: 1, activeTime: 10 };
  let state = admitNextCell(createTraversal(geometry, caps));
  state = dispatchSubmission(reserveSubmission(state, '0,0'), '0,0');
  state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'seed-result' }] });
  const neighbor = state.queue[0];
  state = admitNextCell(state);
  state = pauseTraversal(state);
  assert.throws(() => reserveSubmission(state, neighbor), /stopped|paused/i);
  state = updateTraversalLimits(state, { cells: 4, submissions: 3, activeTime: 20 });
  assert.equal(state.submissions, 1);
  assert.equal(state.activeTime, 0);
  assert.equal(state.admitted.length, 2);
  state = resumeTraversal(state);
  state = dispatchSubmission(reserveSubmission(state, neighbor), neighbor);
  assert.equal(state.submissions, 2);
  state = debitActiveTime(state, 4);
  assert.equal(state.activeTime, 4);
});

test('decreased caps preserve totals and block work without resetting history', () => {
  const initial = { cells: 4, submissions: 4, activeTime: 20 };
  let state = admitNextCell(createTraversal(geometry, initial));
  state = dispatchSubmission(reserveSubmission(state, '0,0'), '0,0');
  state = debitActiveTime(state, 5);
  state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'seed-result' }] });
  const previouslyAdmitted = [...state.admitted];
  state = updateTraversalLimits(state, { cells: 1, submissions: 0, activeTime: 4 });
  assert.equal(state.submissions, 1);
  assert.equal(state.activeTime, 5);
  assert.deepEqual(state.admitted, previouslyAdmitted);
  assert.throws(() => admitNextCell(state), /Active-time limit/);
  assert.equal(reportTraversal(state).outcome, 'partial_limit');
  assert.ok(reportTraversal(state).blocked.length > 0);
});

test('global failure pauses new work and cancellation takes outcome precedence', () => {
  let state = admitNextCell(createTraversal(geometry, { cells: 4, submissions: 10, activeTime: 100 }));
  state = dispatchSubmission(reserveSubmission(state, '0,0'), '0,0');
  state = applyDiscoveryResult(state, '0,0', { status: 'failed', scope: 'global' });
  assert.equal(state.paused, true);
  assert.throws(() => admitNextCell(state), /paused/i);
  assert.equal(reportTraversal(state).outcome, 'partial_gaps');
  state = cancelTraversal(state);
  assert.equal(reportTraversal(state).outcome, 'partial_cancelled');
});

test('discovery result cannot be applied before a submission is dispatched', () => {
  const state = admitNextCell(createTraversal(geometry, limits));
  assert.throws(() => applyDiscoveryResult(state, '0,0', { status: 'empty' }), /dispatched/i);
});
