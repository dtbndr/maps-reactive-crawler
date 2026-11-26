import test from 'node:test';
import assert from 'node:assert/strict';
import * as operator from '../dist/operator.js';
import { validateGeometry, createTraversal } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { executeDurableDiscovery, setDurableDiscoveryBoundaryHookForTest } from '../dist/durable-discovery.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 10, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
const state = (patch = {}) => ({
  timeUnit: 'milliseconds', geometry, limits: { cells: 2, submissions: 3, activeTime: 100 },
  queue: ['0,0'], admitted: ['0,0'], cells: { '0,0': { outcome: 'queued' } }, candidates: [], gaps: [],
  paused: false, submissions: 0, activeTime: 0, blocked: [], attempts: [], cancelled: false, recoveryPending: false,
  ...patch,
});

test('shared eligibility classifies caps, known-ID recovery and refusal before invocation', () => {
  assert.equal(typeof operator.classifyOperatorEligibility, 'function');
  const decide = operator.classifyOperatorEligibility;
  assert.equal(decide(state()).kind, 'submit');
  const known = state({ queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [{ id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'observing', knownId: 'known' }] , submissions: 3, activeTime: 100 });
  assert.equal(decide(known).kind, 'observe-known-id');
  const capped = state({ submissions: 3 });
  const cappedBefore = structuredClone(capped);
  assert.equal(decide(capped).kind, 'submission-cap');
  assert.deepEqual(capped, cappedBefore);
  assert.equal(decide(state({ activeTime: 100 })).kind, 'active-time-cap');
  assert.equal(decide(state({ queue: [], cells: {} })).kind, 'exhausted');
  const reserved = state({ queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [{ id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'reserved' }] });
  assert.equal(decide(reserved).kind, 'refuse-unknown-id');
  const paused = decide(state({ ...reserved, paused: true, cancelled: false }));
  assert.equal(paused.kind, 'paused');
  assert.equal(paused.recoveryPending, false);
  const cancelled = decide(state({ ...reserved, paused: false, cancelled: true }));
  assert.equal(cancelled.kind, 'cancelled');
  assert.equal(cancelled.recoveryPending, false);
  const pausedGlobalGap = decide(state({ ...reserved, paused: true, recoveryPending: true, gaps: [{ cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' }] }));
  assert.equal(pausedGlobalGap.kind, 'paused');
  assert.equal(pausedGlobalGap.globalGap, true);
  const independent = decide(state({ ...reserved, cancelled: true, recoveryPending: true, gaps: [{ cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' }] }));
  assert.equal(independent.recoveryPending, true);
  assert.equal(independent.globalGap, true);
});

test('persisted unknown-ID attempts refuse selection without changing authorization', () => {
  for (const status of ['reserved', 'dispatched']) {
    const attempt = { id: `a-${status}`, workId: 'work:0,0', cellKey: '0,0', status };
    const value = state({ queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [attempt] });
    const before = structuredClone(value);
    assert.equal(operator.classifyOperatorEligibility(value).kind, 'refuse-unknown-id');
    assert.deepEqual(value, before);
    const paused = operator.classifyOperatorEligibility({ ...value, paused: true });
    assert.equal(paused.kind, 'paused');
    assert.equal(paused.attemptId, undefined);
    assert.equal(paused.recoveryPending, false);
    const cancelled = operator.classifyOperatorEligibility({ ...value, cancelled: true });
    assert.equal(cancelled.kind, 'cancelled');
    assert.equal(cancelled.attemptId, undefined);
    assert.equal(cancelled.recoveryPending, false);
  }
  const authorization = { ordinal: 2, ceiling: 4, delayMs: 17 };
  const uncertain = state({ queue: [], cells: { '0,0': { outcome: 'parked' } }, attempts: [{ id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', safeRetryAuthorization: authorization }] });
  assert.equal(operator.classifyOperatorEligibility(uncertain).kind, 'refuse-safe-retry');
  assert.deepEqual(uncertain.attempts[0].safeRetryAuthorization, authorization);
  const paused = operator.classifyOperatorEligibility({ ...uncertain, paused: true });
  assert.equal(paused.kind, 'paused');
  assert.equal(paused.attemptId, undefined);
  assert.equal(paused.recoveryPending, false);
  const cancelled = operator.classifyOperatorEligibility({ ...uncertain, cancelled: true });
  assert.equal(cancelled.kind, 'cancelled');
  assert.equal(cancelled.attemptId, undefined);
  assert.equal(cancelled.recoveryPending, false);
});

test('known-ID continuation across caps and attempt states characterizes existing behavior', () => {
  for (const status of ['dispatched', 'observing', 'uncertain']) {
    const value = state({ queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [{ id: `a-${status}`, workId: 'work:0,0', cellKey: '0,0', status, knownId: 'known', observationRetryPendingDelayMs: 99 }], submissions: 3, activeTime: 100 });
    assert.equal(operator.classifyOperatorEligibility(value).kind, 'observe-known-id');
    assert.equal(value.attempts[0].observationRetryPendingDelayMs, 99);
  }
});

test('global blockers take precedence over refused running attempts', () => {
  const reserved = { id: 'reserved', workId: 'work:0,0', cellKey: '0,0', status: 'reserved' };
  const value = state({ queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [reserved], detailGaps: [{ workId: 'detail:known', identity: 'known', observationIds: [], status: 'unresolved' }] });
  const decision = operator.classifyOperatorEligibility(value);
  assert.equal(decision.kind, 'global-gap');
  assert.equal(decision.recoveryPending, false);
  assert.equal(decision.globalGap, true);
});

test('running recovery work is selected before queued work while paused and cancelled flags stay independent', () => {
  const runningAttempt = { id: 'running', workId: 'work:0,0', cellKey: '0,0', status: 'reserved' };
  const queuedAttempt = { id: 'queued', workId: 'work:1,0', cellKey: '1,0', status: 'reserved' };
  const competing = state({ queue: ['1,0'], cells: { '0,0': { outcome: 'running' }, '1,0': { outcome: 'queued' } }, admitted: ['0,0', '1,0'], attempts: [runningAttempt, queuedAttempt] });
  const selected = operator.classifyOperatorEligibility(competing);
  assert.equal(selected.kind, 'refuse-unknown-id');
  assert.equal(selected.cellKey, '0,0');
  const recoveryBeforeRunning = state({ queue: ['1,0'], admitted: ['0,0', '1,0'], cells: { '0,0': { outcome: 'running' }, '1,0': { outcome: 'queued' } }, attempts: [runningAttempt, { id: 'known', workId: 'work:1,0', cellKey: '1,0', status: 'uncertain', knownId: 'persisted-id' }], submissions: 3 });
  const selectedRecovery = operator.classifyOperatorEligibility(recoveryBeforeRunning);
  assert.equal(selectedRecovery.kind, 'observe-known-id');
  assert.equal(selectedRecovery.cellKey, '1,0');
  assert.equal(operator.classifyOperatorEligibility({ ...competing, paused: true, recoveryPending: true }).kind, 'paused');
  assert.equal(operator.classifyOperatorEligibility({ ...competing, paused: true, recoveryPending: true }).recoveryPending, true);
  assert.equal(operator.classifyOperatorEligibility({ ...competing, cancelled: true, recoveryPending: true }).kind, 'cancelled');
  assert.equal(operator.classifyOperatorEligibility({ ...competing, cancelled: true, recoveryPending: true }).recoveryPending, true);
});

test('persisted known-ID observation behavior is characterized at both caps without retry policy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-known-observation-'));
  const db = DurableState.open(join(directory, 'state.db'));
  try {
    const observationFixture = operator.parseSyntheticFixture(Buffer.from(JSON.stringify({ version: 1, discoveries: {}, observations: { 'known-place': { result: { status: 'empty' }, elapsed: 0 } } })));
    const initial = createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 });
    db.writeTraversal({ ...initial, queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [{ id: 'persisted', workId: 'work:0,0', cellKey: '0,0', status: 'observing', knownId: 'known-place', retryOrdinal: 1, observationRetryCeiling: 2, observationRetryPendingDelayMs: 1 }], submissions: 1, activeTime: 100 });
    let sends = 0;
    let observations = 0;
    const result = executeDurableDiscovery(db, () => { sends++; throw new Error('unexpected send'); }, id => {
      observations++;
      assert.equal(id, 'known-place');
      assert.equal(db.readTraversal().attempts[0].observationRetryPendingDelayMs, undefined);
      return observationFixture.observations[id];
    }, 'isolated', undefined, { monotonicNow: () => 0 });
    assert.equal(observations, 1);
    assert.equal(sends, 0);
    assert.equal(result.submissions, 1);
    assert.equal(result.activeTime, 100);
    assert.equal(result.attempts[0].status, 'observed');
    assert.equal(result.attempts[0].observationRetryPendingDelayMs, undefined);
    assert.deepEqual(Object.keys(observationFixture.discoveries), []);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('parked-only uncertainty blocks alone but not other queued work', () => {
  const parked = { id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain' };
  const only = state({ queue: [], cells: { '0,0': { outcome: 'parked' } }, attempts: [parked], gaps: [{ cellKey: '0,0', cause: 'uncertain', scope: 'isolated', status: 'unresolved' }] });
  assert.equal(operator.classifyOperatorEligibility(only).kind, 'parked-only-uncertainty');
  const alongside = state({ queue: ['1,0'], admitted: ['0,0', '1,0'], cells: { '0,0': { outcome: 'parked' }, '1,0': { outcome: 'queued' } }, attempts: [parked], gaps: only.gaps });
  assert.equal(operator.classifyOperatorEligibility(alongside).kind, 'submit');
  assert.equal(operator.classifyOperatorEligibility(state({ recoveryPending: true })).kind, 'recovery-pending');
  assert.equal(operator.classifyOperatorEligibility(state({ gaps: [{ cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' }] })).kind, 'global-gap');
});

test('dispatched-boundary throw settles interval and remains an unknown-ID refusal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-eligibility-'));
  const db = DurableState.open(join(directory, 'state.db'));
  try {
    db.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 2, activeTime: 100 }));
    let callbacks = 0;
    setDurableDiscoveryBoundaryHookForTest(boundary => { if (boundary === 'dispatched') throw new Error('boundary crash'); });
    assert.throws(() => executeDurableDiscovery(db, () => { callbacks++; return { id: 'unexpected' }; }, () => { callbacks++; return { result: { status: 'empty' }, elapsed: 0 }; }, 'isolated', undefined, { monotonicNow: () => 0 }), /boundary crash/);
    const after = db.readTraversal();
    assert.equal(after.attempts.at(-1).status, 'dispatched');
    assert.equal(after.activeInterval, false);
    assert.equal(after.recoveryPending, false);
    assert.equal(callbacks, 0);
    assert.equal(operator.classifyOperatorEligibility(after).kind, 'refuse-unknown-id');
  } finally {
    setDurableDiscoveryBoundaryHookForTest(undefined);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fixture precheck looks up only selected eligible submission work', () => {
  assert.equal(typeof operator.precheckOperatorFixture, 'function');
  const decide = operator.classifyOperatorEligibility;
  let lookups = 0;
  const lookup = workId => { lookups++; return workId === 'work:0,0'; };
  assert.equal(operator.precheckOperatorFixture(decide(state()), lookup), 'work:0,0');
  assert.equal(lookups, 1);
  const capped = state({ submissions: 3 });
  const cappedBefore = structuredClone(capped);
  let cappedLookups = 0;
  assert.equal(operator.precheckOperatorFixture(decide(capped), _workId => { cappedLookups++; return false; }), undefined);
  assert.equal(cappedLookups, 0);
  assert.equal(lookups, 1);
  assert.deepEqual(capped, cappedBefore);
  const knownId = state({ queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [{ id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'observing', knownId: 'known' }], submissions: 3, activeTime: 100 });
  assert.equal(operator.precheckOperatorFixture(decide(knownId), () => { lookups++; return false; }), undefined);
  assert.equal(lookups, 1);
  assert.throws(() => operator.precheckOperatorFixture(decide(state()), () => { lookups++; return false; }), /Missing fixture discovery/);
  assert.equal(lookups, 2);
  for (const candidate of [state(), state({ queue: [], cells: { '0,0': { outcome: 'running' } } })]) {
    const before = structuredClone(candidate);
    let called = 0;
    assert.throws(() => operator.precheckOperatorFixture(decide(candidate), () => { called++; return false; }), /Missing fixture discovery/);
    assert.equal(called, 1);
    assert.deepEqual(candidate, before);
  }
});
