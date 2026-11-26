import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as operator from '../dist/operator.js';
import * as publicApi from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { executeDurableDiscovery, setDurableDiscoveryBoundaryHookForTest } from '../dist/durable-discovery.js';

const geometry = { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 300 } };
const limits = { cells: 5, submissions: 10, activeTime: 10000 };
const createFiles = () => { const directory = mkdtempSync(join(tmpdir(), 'operator-response-')); return { directory, checkpoint: join(directory, 'state.db'), fixture: join(directory, 'fixture.json') }; };
const bytes = Buffer.from(JSON.stringify({ version: 1, discoveries: { 'work:0,0': { id: 'seed', observationId: 'seed' } }, observations: { seed: { result: { status: 'empty' }, elapsed: 0 } } }));
const fixture = path => writeFileSync(path, bytes);
const expectedStatus = overrides => ({
  version: 1, state: 'idle', headline: 'ready', conditions: [], geometry, limits,
  counters: { admitted: 1, submissions: 0, activeTime: 0 },
  frontier: { queued: ['0,0'], running: [], parked: [], blocked: [], discoveryExhausted: false },
  discoveryGaps: [], detailGaps: [], pendingDetails: [],
  coverage: { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false },
  ...overrides,
});
const expectedResult = (command, status) => ({ version: 1, command, status });
const startOptions = files => ({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits, onPreflight() {} });

test('public API exports the cancel object API', () => {
  assert.equal(typeof publicApi.cancel, 'function');
});

test('start returns exact production post-operation document with released owner', async () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    const result = await operator.start(startOptions(files));
    const state = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    let snapshot;
    try { snapshot = state.readTraversal(); } finally { state.close(); }
    assert.deepEqual(result, expectedResult('start', expectedStatus({
      headline: 'discovery_exhausted', counters: { admitted: 1, submissions: 1, activeTime: snapshot.activeTime },
      frontier: { queued: [], running: [], parked: [], blocked: [], discoveryExhausted: true },
    })));
    assert.equal(snapshot.queue.length, 0);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('successful blocked resume returns exact post-release persisted reservation response', async () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    const state = createTraversal(geometry, limits);
    state.queue = []; state.cells['0,0'] = { outcome: 'running' };
    state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'reserved' }];
    state.submissions = 1;
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, state);
    const result = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture });
    assert.deepEqual(result, expectedResult('resume', expectedStatus({
      headline: 'recovery_pending', conditions: ['recovery_pending'],
      counters: { admitted: 1, submissions: 1, activeTime: 0 },
      frontier: { queued: [], running: ['0,0'], parked: [], blocked: [], discoveryExhausted: false },
    })));
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('cancel is exported, marks state and returns exact cancellation document', () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, createTraversal(geometry, limits));
    assert.deepEqual(publicApi.cancel({ checkpoint: files.checkpoint }), expectedResult('cancel', expectedStatus({ state: 'cancelled', headline: 'cancelled', conditions: ['cancelled'] })));
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('status agrees with eligibility across persisted attempt and independent flags', () => {
  const cases = [
    { name: 'reserved unknown ID', status: 'reserved', expected: ['recovery_pending'] },
    { name: 'dispatched unknown ID', status: 'dispatched', expected: ['recovery_pending'] },
    { name: 'uncertain safe retry', status: 'uncertain', authorization: { ordinal: 1, ceiling: 1 }, expected: ['recovery_pending'] },
    { name: 'observing known ID under caps', status: 'observing', knownId: 'known', caps: true, expected: ['active_time', 'submissions'] },
    { name: 'paused attempt short-circuit', status: 'reserved', paused: true, expected: ['paused'] },
    { name: 'cancelled independent global gap', status: 'reserved', cancelled: true, global: true, expected: ['cancelled', 'global_gap'] },
  ];
  for (const item of cases) {
    const state = createTraversal(geometry, item.caps ? { cells: 5, submissions: 0, activeTime: 0 } : limits);
    state.cells['0,0'] = { outcome: 'running' }; state.queue = [];
    state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: item.status, ...(item.knownId ? { knownId: item.knownId } : {}), ...(item.authorization ? { safeRetryAuthorization: item.authorization } : {}) }];
    state.submissions = 1; state.paused = item.paused ?? false; state.cancelled = item.cancelled ?? false;
    if (item.global) state.gaps = [{ cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' }];
    const decision = operator.classifyOperatorEligibility(state);
    const status = operator.projectOperatorStatus(state);
    assert.deepEqual(status.conditions, item.expected.sort(), item.name);
    assert.equal(status.headline, item.expected.includes('recovery_pending') ? 'recovery_pending' : item.expected.includes('global_gap') ? 'global_gap' : item.expected.includes('cancelled') ? 'cancelled' : item.expected.includes('paused') ? 'paused' : item.expected.includes('submissions') ? 'submissions' : item.expected.includes('active_time') ? 'active_time' : 'ready', item.name);
    assert.equal(status.conditions.includes('recovery_pending'), ['refuse-unknown-id', 'refuse-safe-retry', 'parked-only-uncertainty'].includes(decision.kind), item.name);
  }
});

test('all current unresolved attempts and terminal attempt statuses project without historical scans', () => {
  for (const statusName of ['reserved', 'dispatched', 'uncertain', 'observing']) {
    const state = createTraversal(geometry, limits); state.queue = []; state.cells['0,0'] = { outcome: 'nonempty' };
    state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: statusName, ...(statusName === 'observing' ? { knownId: 'known' } : {}) }];
    state.submissions = 1;
    const status = operator.projectOperatorStatus(state);
    assert.equal(status.frontier.discoveryExhausted, false, `${statusName} attempt prevents exhaustion without a frontier blocker`);
  }
  for (const statusName of ['observed', 'skipped', 'confirmed_no_send']) {
    const state = createTraversal(geometry, limits); state.queue = []; state.cells['0,0'] = { outcome: 'empty' };
    state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: statusName }];
    state.submissions = 1;
    const status = operator.projectOperatorStatus(state);
    assert.equal(status.conditions.includes('recovery_pending'), false, statusName);
    assert.equal(status.frontier.discoveryExhausted, true, statusName);
  }
});

test('status preserves discovery gaps separately from pending detail work and detail gaps', () => {
  const state = createTraversal(geometry, limits);
  state.gaps = [{ cellKey: '0,0', cause: 'failed', scope: 'isolated' }];
  state.detailWork = [{ id: 'detail:observation:1', identity: 'observation:1', observationIds: ['observation:1'], status: 'pending', attempts: [] }];
  state.detailGaps = [{ workId: 'detail:observation:1', identity: 'observation:1', observationIds: ['observation:1'], status: 'unresolved' }];
  const status = operator.projectOperatorStatus(state);
  assert.deepEqual(status.discoveryGaps, [{ id: null, cellKey: '0,0', cause: 'failed', scope: 'isolated', status: null }]);
  assert.deepEqual(status.detailGaps, [{ workId: 'detail:observation:1', identity: 'observation:1', observationIds: ['observation:1'], status: 'unresolved' }]);
  assert.deepEqual(status.pendingDetails, [{ id: 'detail:observation:1', identity: 'observation:1', observationIds: ['observation:1'], status: 'pending' }]);
  assert.deepEqual(status.coverage, { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false });
});

test('latest successors retain uncertain history without false blocker or exhaustion', () => {
  const state = createTraversal(geometry, limits);
  state.cells['0,0'] = { outcome: 'empty' }; state.queue = [];
  state.attempts = [
    { id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain' },
    { id: 'work:0,0:attempt:2', workId: 'work:0,0', cellKey: '0,0', status: 'observed', knownId: 'known' },
  ];
  state.submissions = 2;
  const status = operator.projectOperatorStatus(state);
  assert.deepEqual(status.conditions, []);
  assert.equal(status.frontier.discoveryExhausted, true);
  assert.equal(operator.classifyOperatorEligibility(state).kind, 'exhausted');
});

test('current known-ID successors do not mask an unrelated parked isolated recovery', () => {
  const state = createTraversal(geometry, limits); state.queue = [];
  state.cells['0,0'] = { outcome: 'empty' }; state.cells['1,0'] = { outcome: 'parked' };
  state.attempts = [
    { id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', knownId: 'known-old' },
    { id: 'work:0,0:attempt:2', workId: 'work:0,0', cellKey: '0,0', status: 'observed', knownId: 'known-old' },
    { id: 'work:1,0:attempt:1', workId: 'work:1,0', cellKey: '1,0', status: 'uncertain' },
  ];
  state.submissions = 2;
  assert.equal(operator.classifyOperatorEligibility(state).kind, 'parked-only-uncertainty');
  const status = operator.projectOperatorStatus(state);
  assert.deepEqual(status.conditions, ['recovery_pending']);
  assert.equal(status.headline, 'recovery_pending');
  assert.deepEqual(status.frontier.parked, ['1,0']);
  assert.equal(status.frontier.discoveryExhausted, false);
});

test('reserved-boundary throw persists reservation from the actual writer invocation', async () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, createTraversal(geometry, limits));
    setDurableDiscoveryBoundaryHookForTest(boundary => { if (boundary === 'reserved') throw new Error('reserved boundary fault'); });
    await assert.rejects(operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture }), /reserved boundary fault/);
    const state = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    const persisted = state.readTraversal();
    assert.deepEqual(persisted.attempts.map(({ status, cellKey }) => ({ status, cellKey })), [{ status: 'reserved', cellKey: '0,0' }]);
    assert.equal(persisted.submissions, 1);
    state.close();
    setDurableDiscoveryBoundaryHookForTest(undefined);
    const blockedDocument = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture });
    const verification = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    let activeTime;
    try { activeTime = verification.readTraversal().activeTime; } finally { verification.close(); }
    assert.deepEqual(blockedDocument, expectedResult('resume', expectedStatus({
      state: 'idle', headline: 'recovery_pending', conditions: ['recovery_pending'],
      counters: { admitted: 1, submissions: 1, activeTime },
      frontier: { queued: [], running: ['0,0'], parked: [], blocked: [], discoveryExhausted: false },
    })));
  } finally { setDurableDiscoveryBoundaryHookForTest(undefined); rmSync(files.directory, { recursive: true, force: true }); }
});

test('writer execution and response agree for flags, both caps and known-ID observation', async () => {
  const cases = [
    { name: 'paused', prepare: state => { state.paused = true; }, decision: 'paused', headline: 'paused' },
    { name: 'cancelled', prepare: state => { state.cancelled = true; }, decision: 'cancelled', headline: 'cancelled' },
    { name: 'submission cap', prepare: state => { state.limits = { ...state.limits, submissions: 0 }; }, decision: 'submission-cap', headline: 'submissions' },
    { name: 'active-time cap', prepare: state => { state.activeTime = state.limits.activeTime; }, decision: 'active-time-cap', headline: 'active_time' },
    { name: 'known-ID observation', prepare: state => { state.queue = []; state.cells['0,0'] = { outcome: 'running' }; state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', knownId: 'seed' }]; state.submissions = 1; }, decision: 'observe-known-id', headline: 'discovery_exhausted' },
  ];
  for (const item of cases) {
    const files = createFiles(); fixture(files.fixture);
    try {
      const state = createTraversal(geometry, limits); item.prepare(state);
      assert.equal(operator.classifyOperatorEligibility(state).kind, item.decision, item.name);
      DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, state);
      const result = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture });
      const persisted = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
      try {
        const after = persisted.readTraversal();
        assert.deepEqual(result.status, operator.projectOperatorStatus(after), item.name);
        assert.equal(result.status.headline, item.headline, item.name);
        const expectedState = after.cancelled ? 'cancelled' : 'idle';
        if (after.paused) assert.equal(result.status.state, 'paused', item.name);
        else assert.equal(result.status.state, expectedState, item.name);
      } finally { persisted.close(); }
    } finally { rmSync(files.directory, { recursive: true, force: true }); }
  }
});

test('writer returns independently expected documents for refusal, known-ID recovery and independent recovery flags', async () => {
  const cases = [
    { name: 'dispatched unknown refusal', prepare: state => { state.queue = []; state.cells['0,0'] = { outcome: 'running' }; state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'dispatched' }]; state.submissions = 1; }, expected: { headline: 'recovery_pending', conditions: ['recovery_pending'], counters: { admitted: 1, submissions: 1, activeTime: 0 }, frontier: { queued: [], running: ['0,0'], parked: [], blocked: [], discoveryExhausted: false } } },
    { name: 'safe-retry refusal', prepare: state => { state.queue = []; state.cells['0,0'] = { outcome: 'running' }; state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', safeRetryAuthorization: { ordinal: 1, ceiling: 1 } }]; state.submissions = 1; }, expected: { headline: 'recovery_pending', conditions: ['recovery_pending'], counters: { admitted: 1, submissions: 1, activeTime: 0 }, frontier: { queued: [], running: ['0,0'], parked: [], blocked: [], discoveryExhausted: false } } },
    { name: 'known-ID dispatched', prepare: state => { state.queue = []; state.cells['0,0'] = { outcome: 'running' }; state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'dispatched', knownId: 'seed' }]; state.submissions = 1; }, expected: { headline: 'discovery_exhausted', conditions: [], counters: { admitted: 1, submissions: 1, activeTime: 0 }, frontier: { queued: [], running: [], parked: [], blocked: [], discoveryExhausted: true } } },
    { name: 'known-ID observing', prepare: state => { state.queue = []; state.cells['0,0'] = { outcome: 'running' }; state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'observing', knownId: 'seed' }]; state.submissions = 1; }, expected: { headline: 'discovery_exhausted', conditions: [], counters: { admitted: 1, submissions: 1, activeTime: 0 }, frontier: { queued: [], running: [], parked: [], blocked: [], discoveryExhausted: true } } },
    { name: 'recovery-pending flag', prepare: state => { state.recoveryPending = true; }, expected: { state: 'potentially_interrupted', headline: 'recovery_pending', conditions: ['recovery_pending'] } },
    { name: 'active interval flag', prepare: state => { state.activeInterval = true; }, expected: { state: 'potentially_interrupted', headline: 'recovery_pending', conditions: ['recovery_pending'] } },
  ];
  for (const item of cases) {
    const files = createFiles(); fixture(files.fixture);
    try {
      const state = createTraversal(geometry, limits); item.prepare(state);
      DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, state);
      const result = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture });
      const persisted = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
      let activeTime;
      try { activeTime = persisted.readTraversal().activeTime; } finally { persisted.close(); }
      const expected = { ...item.expected, counters: { ...(item.expected.counters ?? { admitted: 1, submissions: 0, activeTime: 0 }), activeTime } };
      assert.deepEqual(result, expectedResult('resume', expectedStatus(expected)), item.name);
    } finally { rmSync(files.directory, { recursive: true, force: true }); }
  }
});

test('durable executor does not revive a superseded known-ID attempt beside parked isolated recovery', () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    const state = createTraversal(geometry, limits); state.queue = [];
    state.admitted.push('1,0'); state.cells['0,0'] = { outcome: 'empty' }; state.cells['1,0'] = { outcome: 'parked' };
    state.attempts = [
      { id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', knownId: 'seed' },
      { id: 'work:0,0:attempt:2', workId: 'work:0,0', cellKey: '0,0', status: 'observed', knownId: 'seed' },
      { id: 'work:1,0:attempt:1', workId: 'work:1,0', cellKey: '1,0', status: 'uncertain' },
    ]; state.submissions = 3;
    state.gaps = [{ cellKey: '1,0', cause: 'uncertain', scope: 'isolated', status: 'unresolved' }];
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, state);
    const durable = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    let observations = 0;
    try {
      assert.throws(() => executeDurableDiscovery(durable, () => ({ id: 'unexpected' }), () => { observations++; return { result: { status: 'empty' }, elapsed: 0 }; }), /No recoverable discovery work/);
      assert.equal(observations, 0);
      const after = durable.readTraversal();
      assert.deepEqual(after.attempts.map(attempt => attempt.id), ['work:0,0:attempt:1', 'work:0,0:attempt:2', 'work:1,0:attempt:1']);
      assert.equal(after.cells['0,0'].outcome, 'empty');
    } finally { durable.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('writer response follows current recovery state and retains superseded attempt provenance', async () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    const state = createTraversal(geometry, limits); state.queue = [];
    state.admitted.push('1,0'); state.cells['0,0'] = { outcome: 'empty' }; state.cells['1,0'] = { outcome: 'parked' };
    state.attempts = [
      { id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', knownId: 'seed' },
      { id: 'work:0,0:attempt:2', workId: 'work:0,0', cellKey: '0,0', status: 'observed', knownId: 'seed' },
      { id: 'work:1,0:attempt:1', workId: 'work:1,0', cellKey: '1,0', status: 'uncertain' },
    ]; state.submissions = 3;
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, state);
    const result = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture });
    const persisted = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    try {
      const after = persisted.readTraversal();
      assert.deepEqual(result, expectedResult('resume', expectedStatus({ headline: 'recovery_pending', conditions: ['recovery_pending'], counters: { admitted: 2, submissions: 3, activeTime: 0 }, frontier: { queued: [], running: [], parked: ['1,0'], blocked: [], discoveryExhausted: false } })));
      assert.deepEqual(after.attempts.map(({ id, status, knownId }) => ({ id, status, ...(knownId ? { knownId } : {}) })), [
        { id: 'work:0,0:attempt:1', status: 'uncertain', knownId: 'seed' },
        { id: 'work:0,0:attempt:2', status: 'observed', knownId: 'seed' },
        { id: 'work:1,0:attempt:1', status: 'uncertain' },
      ]);
    } finally { persisted.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('clean paused and interrupted cancellation return exact writer documents', () => {
  for (const interrupted of [false, true]) {
    const files = createFiles(); fixture(files.fixture);
    try {
      const state = createTraversal(geometry, limits); state.paused = !interrupted;
      if (interrupted) state.activeInterval = true;
      DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, state);
      const document = publicApi.cancel({ checkpoint: files.checkpoint });
      assert.deepEqual(document, expectedResult('cancel', expectedStatus({
        state: interrupted ? 'potentially_interrupted' : 'cancelled',
        headline: interrupted ? 'recovery_pending' : 'cancelled',
        conditions: interrupted ? ['cancelled', 'recovery_pending'] : ['cancelled', 'paused'],
      })));
    } finally { rmSync(files.directory, { recursive: true, force: true }); }
  }
});

test('release failure is an error and close still closes the checkpoint connection', () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, createTraversal(geometry, limits));
    const db = new DatabaseSync(files.checkpoint);
    db.exec("CREATE TRIGGER retain_owner BEFORE DELETE ON owner BEGIN SELECT RAISE(IGNORE); END"); db.close();
    assert.throws(() => publicApi.cancel({ checkpoint: files.checkpoint }), /owner|release/i);
    const verify = new DatabaseSync(files.checkpoint);
    assert.equal(verify.prepare('SELECT pid FROM owner').get().pid, process.pid);
    verify.close();
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('snapshot failure is returned as error after owner release', () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, createTraversal(geometry, limits));
    const db = new DatabaseSync(files.checkpoint);
    db.exec("CREATE TRIGGER corrupt_cancel_snapshot AFTER UPDATE ON traversal BEGIN UPDATE traversal SET payload='{}' WHERE id=1; END"); db.close();
    assert.throws(() => publicApi.cancel({ checkpoint: files.checkpoint }));
    const verify = new DatabaseSync(files.checkpoint);
    assert.equal(verify.prepare('SELECT COUNT(*) AS count FROM owner').get().count, 0);
    verify.close();
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('status v1 projection selects exact nested fields and sorts detail gaps by observation IDs', () => {
  const state = createTraversal(geometry, limits);
  state.geometry = structuredClone(state.geometry); state.limits = { ...state.limits };
  state.geometry.extra = 'must-not-project'; state.limits.extra = 99;
  state.detailGaps = [
    { workId: 'same', identity: 'same', observationIds: ['z'], status: 'unresolved', extra: 'must-not-project' },
    { workId: 'same', identity: 'same', observationIds: ['a'], status: 'unresolved' },
  ];
  const status = operator.projectOperatorStatus(state);
  assert.deepEqual(status.geometry, geometry);
  assert.deepEqual(status.limits, limits);
  assert.deepEqual(status.detailGaps, [
    { workId: 'same', identity: 'same', observationIds: ['a'], status: 'unresolved' },
    { workId: 'same', identity: 'same', observationIds: ['z'], status: 'unresolved' },
  ]);
});

test('real CLI blocked resume and successful cancel emit independent complete v1 documents', () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    const blocked = createTraversal(geometry, limits); blocked.queue = []; blocked.cells['0,0'] = { outcome: 'running' };
    blocked.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'reserved' }]; blocked.submissions = 1;
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, blocked);
    const resumed = spawnSync(process.execPath, ['dist/cli.js', 'resume', '--checkpoint', files.checkpoint, '--fixture', files.fixture], { encoding: 'utf8' });
    assert.equal(resumed.status, 0, resumed.stderr); assert.equal(resumed.stderr, '');
    assert.deepEqual(JSON.parse(resumed.stdout), expectedResult('resume', expectedStatus({ headline: 'recovery_pending', conditions: ['recovery_pending'], counters: { admitted: 1, submissions: 1, activeTime: 0 }, frontier: { queued: [], running: ['0,0'], parked: [], blocked: [], discoveryExhausted: false } })));
    rmSync(files.checkpoint, { force: true });
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, createTraversal(geometry, limits));
    const cancelled = spawnSync(process.execPath, ['dist/cli.js', 'cancel', '--checkpoint', files.checkpoint], { encoding: 'utf8' });
    assert.equal(cancelled.status, 0, cancelled.stderr); assert.equal(cancelled.stderr, '');
    assert.deepEqual(JSON.parse(cancelled.stdout), expectedResult('cancel', expectedStatus({ state: 'cancelled', headline: 'cancelled', conditions: ['cancelled'] })));
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('real CLI start emits the same exact production response document as the shared projector', () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    const result = spawnSync(process.execPath, ['dist/cli.js', 'start', '--checkpoint', files.checkpoint, '--fixture', files.fixture, '--lat', '0', '--lon', '0', '--spacing-m', '100', '--radius-m', '300', '--cells', '5', '--submissions', '10', '--active-ms', '10000'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stderr.trim().split('\n').map(line => JSON.parse(line)), [{ version: 1, type: 'preflight', geometry, limits }]);
    const state = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    let snapshot;
    try { snapshot = state.readTraversal(); } finally { state.close(); }
    assert.deepEqual(JSON.parse(result.stdout), expectedResult('start', operator.projectOperatorStatus(snapshot)));
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('real CLI resume and cancel refuse a planted live PID without changing logical state', () => {
  const files = createFiles(); fixture(files.fixture);
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity, createTraversal(geometry, limits));
    const db = new DatabaseSync(files.checkpoint);
    db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(process.pid); db.close();
    const before = new DatabaseSync(files.checkpoint);
    const logicalBefore = {
      traversal: before.prepare('SELECT payload FROM traversal').get().payload,
      checkpoint: before.prepare('SELECT payload FROM checkpoint').get().payload,
      binding: before.prepare('SELECT payload FROM operator_binding').get().payload,
      owner: before.prepare('SELECT pid FROM owner').get().pid,
    };
    for (const args of [
      ['resume', '--checkpoint', files.checkpoint, '--fixture', files.fixture],
      ['cancel', '--checkpoint', files.checkpoint],
    ]) {
      const result = spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, args[0]); assert.equal(result.stdout, '', args[0]);
      const after = new DatabaseSync(files.checkpoint);
      assert.deepEqual({
        traversal: after.prepare('SELECT payload FROM traversal').get().payload,
        checkpoint: after.prepare('SELECT payload FROM checkpoint').get().payload,
        binding: after.prepare('SELECT payload FROM operator_binding').get().payload,
        owner: after.prepare('SELECT pid FROM owner').get().pid,
      }, logicalBefore, args[0]);
      after.close();
    }
    before.close();
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});
