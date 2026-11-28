import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import { parseSyntheticFixture } from '../dist/operator.js';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';
import { executeDurableDetail } from '../dist/durable-discovery.js';

const geometry = { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 300 } };
const initialLimits = { cells: 5, submissions: 1, activeTime: 10000 };
const workIds = ['work:0,0', 'work:0,1', 'work:0,-1', 'work:1,0', 'work:-1,0'];
const fixtureDocument = {
  version: 1,
  discoveries: Object.fromEntries(workIds.map((workId, index) => [workId, { id: `job-${index}`, observationId: `job-${index}` }])),
  observations: {
    'job-0': { result: { status: 'success', candidates: [
      { id: 'place-a', coordinate: { latitude: 0.001, longitude: 0.002 }, verifiedCanonicalKey: 'verified-shared' },
      { id: 'place-a-duplicate', coordinate: { latitude: 0.003, longitude: 0.004 }, verifiedCanonicalKey: 'verified-shared' },
      { id: 'unverified-a' },
    ] }, elapsed: 1 },
    'job-1': { result: { status: 'success', candidates: [
      { id: 'neighbor-only', coordinate: { latitude: 0.01, longitude: 0.02 }, verifiedCanonicalKey: 'neighbor-identity' },
      { id: 'unverified-neighbor' },
    ] }, elapsed: 1 },
    'job-2': { result: { status: 'empty' }, elapsed: 1 },
    'job-3': { result: { status: 'empty' }, elapsed: 1 },
    'job-4': { result: { status: 'empty' }, elapsed: 1 },
  },
};
const createFiles = () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-acceptance-'));
  const checkpoint = join(directory, 'state.db');
  const fixture = join(directory, 'fixture.json');
  writeFileSync(fixture, JSON.stringify(fixtureDocument));
  return { directory, checkpoint, fixture };
};
const run = (args) => spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });
const commandJson = child => {
  assert.equal(child.status, 0, `${child.stderr}${child.stdout}`);
  return JSON.parse(child.stdout);
};
const startArgs = files => ['start', '--checkpoint', files.checkpoint, '--fixture', files.fixture, '--lat', '0', '--lon', '0', '--spacing-m', '100', '--radius-m', '300', '--cells', '5', '--submissions', '1', '--active-ms', '10000'];
const inspectDurable = (checkpoint, fixture) => {
  const identity = parseSyntheticFixture(readFileSync(fixture)).identity;
  const db = DurableState.openBound(checkpoint, identity);
  try { return db.readTraversal(); } finally { db.close(); }
};
const assertPendingDetails = state => {
  assert.ok(state.detailWork.length > 0);
  assert.ok(state.detailWork.every(work => work.status === 'pending' && work.attempts.length === 0));
};
const assertNoCoverageClaim = status => {
  assert.deepEqual(status.coverage, { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false });
};

test('separate public CLI processes resume durable seed work, preserve provenance, and export distinct neighbor results', () => {
  const files = createFiles();
  try {
    const startProcess = run(startArgs(files));
    const started = commandJson(startProcess);
    assert.deepEqual(startProcess.stderr.trim().split('\\n').map(line => JSON.parse(line)), [{ version: 1, type: 'preflight', geometry, limits: initialLimits }]);
    assert.equal(started.command, 'start');
    assert.equal(started.status.counters.submissions, 1);
    assert.equal(started.status.counters.admitted, 5);
    assert.deepEqual(started.status.frontier.queued, ['-1,0', '0,-1', '0,1', '1,0']);
    assert.equal(started.status.pendingDetails.length, 2);
    assertNoCoverageClaim(started.status);
    const afterStart = inspectDurable(files.checkpoint, files.fixture);
    assert.equal(afterStart.attempts.length, 1);
    assert.equal(afterStart.attempts[0].cellKey, '0,0');
    assert.equal(afterStart.attempts[0].id, 'work:0,0:attempt:1');
    assertPendingDetails(afterStart);

    const resumed = commandJson(run(['resume', '--checkpoint', files.checkpoint, '--fixture', files.fixture, '--submissions', '5']));
    assert.equal(resumed.command, 'resume');
    assert.equal(resumed.status.counters.submissions, 5);
    assert.ok(resumed.status.conditions.includes('cells'));
    assert.ok(resumed.status.conditions.includes('submissions'));
    assert.equal(resumed.status.limits.submissions, 5);
    assert.equal(resumed.status.pendingDetails.length, 4);
    assertNoCoverageClaim(resumed.status);
    const afterResume = inspectDurable(files.checkpoint, files.fixture);
    assert.equal(afterResume.attempts.length, 5);
    assert.equal(afterResume.attempts.filter(attempt => attempt.cellKey === '0,0').length, 1);
    assert.deepEqual(afterResume.attempts.map(attempt => attempt.id), workIds.map((_, index) => `work:${['0,0','0,1','0,-1','1,0','-1,0'][index]}:attempt:1`));
    assertPendingDetails(afterResume);

    const status = commandJson(run(['status', '--checkpoint', files.checkpoint]));
    const exported = commandJson(run(['export', '--checkpoint', files.checkpoint]));
    assert.deepEqual(status, resumed.status);
    assert.deepEqual(exported.status, status);
    const shared = exported.verifiedPlaces.find(place => place.canonicalKey === 'verified-shared');
    assert.equal(shared.observations.length, 2);
    assert.deepEqual(shared.observations.map(item => item.id), ['place-a', 'place-a-duplicate']);
    assert.equal(exported.verifiedPlaces.some(place => place.canonicalKey === 'neighbor-identity' && place.observations.some(item => item.id === 'neighbor-only')), true);
    assert.equal(exported.unverifiedObservations.some(item => item.id === 'unverified-a'), true);
    assert.equal(exported.unverifiedObservations.some(item => item.id === 'unverified-neighbor'), true);
    assert.equal(exported.verifiedPlaces.some(place => place.observations.some(item => item.id === 'place-a' && item.sourceCell === '0,0')), true);
    assert.equal(exported.verifiedPlaces.some(place => place.observations.some(item => item.id === 'neighbor-only' && item.sourceCell === '0,1')), true);
    assertNoCoverageClaim(exported.status);
    const v2 = commandJson(run(['export', '--checkpoint', files.checkpoint, '--format', 'v2']));
    assert.equal(v2.version, 2);
    assert.deepEqual(v2.status, status);
    const v2shared = v2.verifiedPlaces.find(place => place.canonicalKey === 'verified-shared');
    assert.deepEqual(v2shared.observations.map(item => item.candidateId), ['place-a', 'place-a-duplicate']);
    assert.deepEqual(v2shared.observations.map(item => [item.sourceCell, item.workId, item.attemptId, item.occurrence]), afterResume.candidates.slice(0, 2).map(item => [item.sourceCell, 'work:0,0', item.attemptId, item.occurrence]));
    const all = [...v2.verifiedPlaces.flatMap(place => place.observations), ...v2.unverifiedObservations];
    assert.equal(all.length, afterResume.candidates.length);
    assert.ok(all.every(item => item.name === null && item.fieldStatus.name === 'not_present' && item.detailState === 'not_attempted'));
    assert.ok(status.frontier.blocked.length > 0);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('fresh B7 harness processes witness discovery ordering and replay separately from durable detail records', () => {
  const files = createFiles();
  const witness = join(files.directory, 'witness.ndjson');
  try {
    const start = spawnSync(process.execPath, ['test/operator-harness.mjs', 'start', JSON.stringify({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: initialLimits, witness })], { encoding: 'utf8' });
    assert.equal(start.status, 0, start.stderr);
    const started = JSON.parse(start.stdout);
    assert.equal(started.status.counters.submissions, 1);
    assert.equal(started.status.pendingDetails.length, 2);
    const afterStart = inspectDurable(files.checkpoint, files.fixture);
    assert.equal(afterStart.attempts.length, 1);
    assert.equal(afterStart.attempts[0].id, 'work:0,0:attempt:1');
    assertPendingDetails(afterStart);
    const resume = spawnSync(process.execPath, ['test/operator-harness.mjs', 'resume', JSON.stringify({ checkpoint: files.checkpoint, fixture: files.fixture, limits: { submissions: 5 }, witness })], { encoding: 'utf8' });
    assert.equal(resume.status, 0, `${resume.stderr}${resume.stdout}`);
    const resumed = JSON.parse(resume.stdout);
    assert.equal(resumed.status.counters.submissions, 5);
    assert.equal(resumed.status.pendingDetails.length, 4);
    const afterResume = inspectDurable(files.checkpoint, files.fixture);
    assert.equal(afterResume.attempts.length, 5);
    assert.equal(afterResume.attempts.filter(attempt => attempt.cellKey === '0,0').length, 1);
    assertPendingDetails(afterResume);
    const harnessExport = commandJson(run(['export', '--checkpoint', files.checkpoint]));
    assert.equal(harnessExport.verifiedPlaces.some(place => place.canonicalKey === 'neighbor-identity' && place.observations.some(item => item.id === 'neighbor-only' && item.sourceCell === '0,1')), true);
    assert.equal(harnessExport.unverifiedObservations.some(item => item.id === 'unverified-neighbor'), true);
    const events = readFileSync(witness, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.filter(event => event.type === 'preflight').map(event => event.type), ['preflight']);
    assert.deepEqual(events.filter(event => event.type === 'send').map(event => event.workId), workIds);
    assert.equal(events.findIndex(event => event.type === 'preflight') < events.findIndex(event => event.type === 'send'), true);
    assert.equal(events.some(event => event.type.includes('detail')), false);
    const state = inspectDurable(files.checkpoint, files.fixture);
    assert.equal(state.attempts.length, 5);
    assert.deepEqual(state.attempts.map(attempt => attempt.workId), workIds);
    assert.equal(state.attempts.filter(attempt => attempt.cellKey === '0,0').length, 1);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('discovery exhaustion remains distinct from isolated failure, unrecognized, global uncertainty, recovery, and cancellation', () => {
  const runOutcome = (result, options = {}) => {
    const files = createFiles();
    try {
      const altered = structuredClone(fixtureDocument);
      altered.observations['job-0'].result = result;
      for (const key of ['job-1', 'job-2', 'job-3', 'job-4']) delete altered.discoveries[key];
      writeFileSync(files.fixture, JSON.stringify(altered));
      const command = options.command ?? 'start';
      const args = command === 'start'
        ? ['start', '--checkpoint', files.checkpoint, '--fixture', files.fixture, '--lat', '0', '--lon', '0', '--spacing-m', '100', '--radius-m', '1', '--cells', '5', '--submissions', '10', '--active-ms', '10000']
        : ['resume', '--checkpoint', files.checkpoint, '--fixture', files.fixture];
      const harness = options.harness;
      if (harness) {
        const child = spawnSync(process.execPath, ['test/operator-harness.mjs', command, JSON.stringify({ checkpoint: files.checkpoint, fixture: files.fixture, geometry: { ...geometry, area: { type: 'radius', radius: 1 } }, limits: { cells: 5, submissions: 10, activeTime: 10000 }, witness: join(files.directory, 'witness.ndjson'), ...(options.fault ? { fault: options.fault } : {}), ...(options.abortAfterSend ? { abortAfterSend: true } : {}) })], { encoding: 'utf8' });
        return { child, files, close: () => rmSync(files.directory, { recursive: true, force: true }) };
      }
      return { child: run(args), files, close: () => rmSync(files.directory, { recursive: true, force: true }) };
    } catch (error) { rmSync(files.directory, { recursive: true, force: true }); throw error; }
  };
  const isolated = runOutcome({ status: 'failed', cause: 'fixture-isolated', scope: 'isolated' });
  try {
    const value = commandJson(isolated.child);
    assert.equal(value.status.discoveryGaps[0].cause, 'failed');
    assert.equal(value.status.headline, 'discovery_exhausted');
    assert.equal(value.status.discoveryGaps[0].scope, 'isolated');
    assert.equal(value.status.discoveryGaps[0].cause, 'failed');
  } finally { isolated.close(); }
  const unrecognized = runOutcome({ status: 'unrecognized' });
  try {
    const value = commandJson(unrecognized.child);
    assert.equal(value.status.discoveryGaps[0].scope, null);
    assert.equal(value.status.headline, 'discovery_exhausted');
    assert.equal(value.status.discoveryGaps[0].cause, 'unrecognized');
  } finally { unrecognized.close(); }
  const empty = runOutcome({ status: 'empty' });
  try {
    const value = commandJson(empty.child);
    assert.equal(value.status.state, 'idle');
    assert.equal(value.status.headline, 'discovery_exhausted');
    assert.deepEqual(value.status.discoveryGaps, []);
    assertNoCoverageClaim(value.status);
  } finally { empty.close(); }
  const global = runOutcome({ status: 'failed', cause: 'global-uncertainty', scope: 'global' }, { harness: true });
  try {
    const value = commandJson(global.child);
    assert.equal(value.status.headline, 'global_gap');
    assert.ok(value.status.conditions.includes('global_gap'));
    assert.equal(value.status.discoveryGaps[0].scope, 'global');
    const identity = parseSyntheticFixture(readFileSync(global.files.fixture)).identity;
    const db = DurableState.openBound(global.files.checkpoint, identity);
    try { db.transitionTraversal(state => ({ ...state, gaps: state.gaps.map(gap => ({ ...gap, status: 'unresolved' })) })); } finally { db.close(); }
    const publicStatus = commandJson(run(['status', '--checkpoint', global.files.checkpoint]));
    assert.equal(publicStatus.discoveryGaps[0].status, 'unresolved');
    assert.equal(publicStatus.headline, 'global_gap');
    assertNoCoverageClaim(publicStatus);
  } finally { global.close(); }
});

test('an original injected send fault remains an error; a later public resume reports unresolved recovery', () => {
  const files = createFiles();
  const witness = join(files.directory, 'witness.ndjson');
  try {
    const fault = spawnSync(process.execPath, ['test/operator-harness.mjs', 'start', JSON.stringify({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: initialLimits, witness, fault: 'send-throw' })], { encoding: 'utf8' });
    assert.notEqual(fault.status, 0);
    assert.match(fault.stderr, /injected send fault/);
    assert.equal(fault.stdout, '');
    const before = inspectDurable(files.checkpoint, files.fixture);
    assert.equal(before.attempts.length, 1);
    assert.equal(before.attempts[0].status, 'uncertain');
    assert.equal(before.activeInterval, false);
    const blocked = commandJson(run(['resume', '--checkpoint', files.checkpoint, '--fixture', files.fixture]));
    assert.equal(blocked.command, 'resume');
    assert.equal(blocked.status.headline, 'recovery_pending');
    assert.ok(blocked.status.conditions.includes('recovery_pending'));
    assert.equal(blocked.status.discoveryGaps[0].scope, 'isolated');
    const after = inspectDurable(files.checkpoint, files.fixture);
    assert.equal(after.attempts.length, 1);
    assert.equal(after.attempts[0].status, 'uncertain');
    const sends = readFileSync(witness, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(event => event.type === 'send');
    assert.deepEqual(sends.map(event => event.workId), ['work:0,0']);
    assertNoCoverageClaim(blocked.status);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('harness cancellation is a separate durable outcome with its own public response condition', () => {
  const files = createFiles();
  try {
    const altered = structuredClone(fixtureDocument);
    altered.observations['job-0'].result = { status: 'success', candidates: [{ id: 'cancel-detail', verifiedCanonicalKey: 'cancel-detail' }] };
    writeFileSync(files.fixture, JSON.stringify(altered));
    const child = spawnSync(process.execPath, ['test/operator-harness.mjs', 'start', JSON.stringify({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: initialLimits, witness: join(files.directory, 'witness.ndjson'), abortAfterSend: true })], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const value = JSON.parse(child.stdout);
    assert.equal(value.status.state, 'cancelled');
    assert.equal(value.status.headline, 'cancelled');
    assert.ok(value.status.conditions.includes('cancelled'));
    assert.ok(value.status.conditions.includes('submissions'));
    assert.equal(value.status.pendingDetails.length, 1);
    assertNoCoverageClaim(value.status);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('increasing the cell cap does not promote neighbors blocked at expansion', () => {
  const files = createFiles();
  try {
    const start = run(['start', '--checkpoint', files.checkpoint, '--fixture', files.fixture, '--lat', '0', '--lon', '0', '--spacing-m', '100', '--radius-m', '300', '--cells', '1', '--submissions', '1', '--active-ms', '10000']);
    const before = commandJson(start).status;
    assert.deepEqual(before.frontier.blocked, ['-1,0', '0,-1', '0,1', '1,0']);
    const resumed = commandJson(run(['resume', '--checkpoint', files.checkpoint, '--fixture', files.fixture, '--cells', '2', '--submissions', '2'])).status;
    assert.deepEqual(resumed.frontier.blocked, before.frontier.blocked);
    assert.deepEqual(resumed.frontier.queued, []);
    assert.equal(resumed.counters.submissions, 1);
    assertNoCoverageClaim(resumed);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('direct detail executor boundary leaves pending work undispatched when cancelled', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-detail-boundary-'));
  const checkpoint = join(directory, 'state.db');
  const config = validateGeometry(geometry);
  const state = createTraversal(config, { cells: 1, submissions: 5, activeTime: 10000 });
  const seed = state.queue[0];
  const reserved = reserveSubmission(admitNextCell(state), seed);
  const observed = observeKnownId({ ...reserved, attempts: reserved.attempts.map(attempt => ({ ...attempt, status: 'dispatched', knownId: 'seed-id' })) }, seed, 'seed-id', 0);
  const discovered = applyDiscoveryResult(observed, seed, { status: 'success', candidates: [{ id: 'detail-candidate', verifiedCanonicalKey: 'detail-key' }] });
  const pending = { ...discovered, cancelled: true };
  const db = DurableState.open(checkpoint);
  let sends = 0;
  let observations = 0;
  try {
    db.writeTraversal(pending);
    const workId = pending.detailWork[0].id;
    assert.throws(() => executeDurableDetail(db, workId, () => { sends++; return { id: 'detail-id' }; }, () => { observations++; return { elapsed: 0 }; }, { monotonicNow: () => 0 }), /paused/i);
    const after = db.readTraversal();
    assert.equal(after.detailWork[0].status, 'pending');
    assert.equal(after.detailWork[0].attempts.length, 0);
    assert.equal(sends, 0);
    assert.equal(observations, 0);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
