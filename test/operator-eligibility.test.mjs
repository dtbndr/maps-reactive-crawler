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
  assert.equal(decide(capped).kind, 'submission-cap');
  const reserved = state({ queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [{ id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'reserved' }] });
  assert.equal(decide(reserved).kind, 'refuse-unknown-id');
  assert.equal(decide(state({ ...reserved, paused: true })).kind, 'paused');
  assert.equal(decide(state({ ...reserved, cancelled: true })).kind, 'cancelled');
  assert.equal(decide(state({ ...reserved, paused: true, recoveryPending: true, gaps: [{ cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' }] })).kind, 'paused');
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
    assert.equal(operator.classifyOperatorEligibility({ ...value, paused: true }).kind, 'paused');
    assert.equal(operator.classifyOperatorEligibility({ ...value, cancelled: true }).kind, 'cancelled');
  }
  const authorization = { ordinal: 2, ceiling: 4, delayMs: 17 };
  const uncertain = state({ queue: [], cells: { '0,0': { outcome: 'parked' } }, attempts: [{ id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', safeRetryAuthorization: authorization }] });
  assert.equal(operator.classifyOperatorEligibility(uncertain).kind, 'refuse-safe-retry');
  assert.deepEqual(uncertain.attempts[0].safeRetryAuthorization, authorization);
  assert.equal(operator.classifyOperatorEligibility({ ...uncertain, paused: true }).kind, 'paused');
  assert.equal(operator.classifyOperatorEligibility({ ...uncertain, cancelled: true }).kind, 'cancelled');
});

test('known-ID continuation remains eligible across caps and attempt states', () => {
  for (const status of ['dispatched', 'observing', 'uncertain']) {
    const value = state({ queue: [], cells: { '0,0': { outcome: 'running' } }, attempts: [{ id: `a-${status}`, workId: 'work:0,0', cellKey: '0,0', status, knownId: 'known', observationRetryPendingDelayMs: 99 }], submissions: 3, activeTime: 100 });
    assert.equal(operator.classifyOperatorEligibility(value).kind, 'observe-known-id');
    assert.equal(value.attempts[0].observationRetryPendingDelayMs, 99);
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
  assert.equal(operator.precheckOperatorFixture(decide(state({ submissions: 3 })), lookup), undefined);
  assert.equal(lookups, 1);
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
