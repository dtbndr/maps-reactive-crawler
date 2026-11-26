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
    const state = createTraversal(geometry, limits); state.queue = []; state.cells['0,0'] = { outcome: 'running' };
    state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: statusName, ...(statusName === 'observing' ? { knownId: 'known' } : {}) }];
    state.submissions = 1;
    const status = operator.projectOperatorStatus(state);
    assert.equal(status.conditions.includes('recovery_pending'), statusName !== 'observing', statusName);
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
