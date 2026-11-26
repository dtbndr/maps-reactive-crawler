import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as operator from '../dist/operator.js';
import * as publicOperator from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const geometry = { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 300 } };
const limits = { cells: 5, submissions: 10, activeTime: 10000 };
const temp = () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-execution-'));
  return { directory, checkpoint: join(directory, 'state.db'), fixture: join(directory, 'fixture.json') };
};
const fixture = (discoveries = {}, observations = {}) => Buffer.from(JSON.stringify({ version: 1, discoveries, observations }));
const saveFixture = (path, bytes) => writeFileSync(path, bytes);
const preflight = () => {};
const runWithDependencies = (command, options, overrides = {}) => {
  const parsed = operator.parseSyntheticFixture(readFileSync(options.fixture));
  return operator.runOperatorWithDependencies(command, options, {
    send: overrides.send ?? (workId => ({ id: parsed.discoveries[workId].id })),
    observe: overrides.observe ?? (id => parsed.observations[id]),
    onPreflight: overrides.onPreflight ?? options.onPreflight ?? preflight,
  });
};

test('start binds and executes the same fixture bytes when preflight replaces the fixture file', async () => {
  const files = temp();
  const original = fixture({ 'work:0,0': { id: 'same-work', observationId: 'same-work' } }, { 'same-work': { result: { status: 'empty' }, elapsed: 0 } });
  const replacement = fixture({ 'work:0,0': { id: 'same-work', observationId: 'same-work' } }, { 'same-work': { result: { status: 'success', candidates: [{ id: 'replacement' }] }, elapsed: 0 } });
  try {
    saveFixture(files.fixture, original);
    const result = await operator.start({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: { ...limits, cells: 1 }, onPreflight: () => saveFixture(files.fixture, replacement) });
    assert.equal(result.status.counters.submissions, 1);
    const expectedIdentity = operator.parseSyntheticFixture(original).identity;
    const durable = DurableState.openBound(files.checkpoint, expectedIdentity);
    try {
      const state = durable.readTraversal();
      assert.equal(state.cells['0,0'].outcome, 'empty');
      assert.deepEqual(state.candidates, []);
    } finally { durable.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('start preflight cannot mutate nested validated configuration used to initialize traversal', async () => {
  const files = temp();
  try {
    const bytes = fixture({ 'work:0,0': { id: 'seed', observationId: 'seed' } }, { seed: { result: { status: 'empty' }, elapsed: 0 } });
    saveFixture(files.fixture, bytes);
    const originalGeometry = structuredClone(geometry);
    const originalLimits = { ...limits, cells: 2 };
    await operator.start({ checkpoint: files.checkpoint, fixture: files.fixture, geometry: originalGeometry, limits: originalLimits, onPreflight: configuration => {
      configuration.geometry.seed.latitude = 22;
      configuration.geometry.area.radius = 1;
      configuration.limits.cells = 99;
    } });
    const durable = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    try {
      const state = durable.readTraversal();
      assert.deepEqual(state.geometry.seed, { latitude: 0, longitude: 0 });
      assert.deepEqual(state.geometry.area, { type: 'radius', radius: 300 });
      assert.equal(state.limits.cells, 2);
    } finally { durable.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('start validates and preflights before serial fixture-backed discovery, leaving detail pending', async () => {
  const files = temp();
  try {
    const bytes = fixture({ 'work:0,0': { id: 'job-0', observationId: 'job-0' } }, { 'job-0': { result: { status: 'success', candidates: [{ id: 'place', verifiedCanonicalKey: 'place-key' }] }, elapsed: 9999 } });
    saveFixture(files.fixture, bytes);
    let beforeSend;
    let sends = 0;
    const result = await runWithDependencies('start', { checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: { ...limits, cells: 1 }, onPreflight: value => {
      beforeSend = value;
      assert.equal(existsSync(files.checkpoint), false);
      assert.equal(sends, 0);
    } }, { send: workId => { sends++; return { id: operator.parseSyntheticFixture(bytes).discoveries[workId].id }; } });
    assert.equal(sends, 1);
    assert.deepEqual(beforeSend, { geometry, limits: { ...limits, cells: 1 } });
    assert.equal(result.command, 'start');
    const db = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    try {
      const state = db.readTraversal();
      assert.equal(state.submissions, 1);
      assert.equal(state.attempts.length, 1);
      assert.equal(state.detailWork[0].status, 'pending');
      assert.equal(state.detailWork[0].attempts.length, 0);
      assert.equal(state.activeTime < 9999, true);
    } finally { db.close(); }
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test('submission-cap resume drains admitted queue without replay and preserves omitted active-time cap', async () => {
  const files = temp();
  const workIds = ['work:0,0', 'work:0,1', 'work:0,-1', 'work:1,0', 'work:-1,0'];
  const discoveries = Object.fromEntries(workIds.map(workId => [workId, { id: workId, observationId: workId }]));
  const observations = Object.fromEntries(workIds.map((workId, index) => [workId, {
    result: index === 0 ? { status: 'success', candidates: [{ id: 'place' }] } : { status: 'empty' },
    elapsed: index === 0 ? 17 : 0,
  }]));
  const bytes = fixture(discoveries, observations);
  saveFixture(files.fixture, bytes);
  const sends = [];
  try {
    const dependencies = { send: workId => { sends.push(workId); return { id: workId }; } };
    const stopped = await runWithDependencies('start', { checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: { cells: 5, submissions: 1, activeTime: 10000 }, onPreflight: preflight }, dependencies);
    assert.equal(stopped.command, 'start');
    assert.deepEqual(stopped.status.frontier.queued, ['-1,0', '0,-1', '0,1', '1,0']);
    assert.deepEqual(stopped.status.frontier.blocked, []);
    assert.deepEqual(stopped.status.counters, { admitted: 5, submissions: 1, activeTime: stopped.status.counters.activeTime });
    assert.deepEqual(sends, ['work:0,0']);

    const resumed = await runWithDependencies('resume', { checkpoint: files.checkpoint, fixture: files.fixture, limits: { submissions: 5 } }, dependencies);
    assert.equal(resumed.command, 'resume');
    assert.deepEqual(resumed.status.frontier.queued, []);
    assert.equal(resumed.status.counters.submissions, 5);
    assert.equal(resumed.status.limits.submissions, 5);
    assert.equal(resumed.status.limits.activeTime, 10000);
    assert.deepEqual(sends, workIds);
    const completed = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    try { assert.deepEqual(completed.readTraversal().attempts.map(attempt => attempt.workId), workIds); } finally { completed.close(); }
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test('resume requires every supplied cap to strictly increase and rejects mixed updates atomically', async () => {
  const files = temp();
  try {
    const bytes = fixture({ 'work:0,0': { id: 'job-0', observationId: 'job-0' }, 'work:0,1': { id: 'job-1', observationId: 'job-1' } }, { 'job-0': { result: { status: 'success', candidates: [{ id: 'place' }] }, elapsed: 0 }, 'job-1': { result: { status: 'empty' }, elapsed: 0 } });
    saveFixture(files.fixture, bytes);
    await operator.start({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: { ...limits, cells: 1, submissions: 1 }, onPreflight: preflight });
    const before = operator.parseSyntheticFixture(bytes).identity;
    const db = DurableState.openBound(files.checkpoint, before);
    let original;
    try { original = db.readTraversal(); } finally { db.close(); }
    assert.deepEqual([...original.blocked].sort(), ['-1,0', '0,-1', '0,1', '1,0']);
    for (const caps of [{ submissions: 1 }, { submissions: 0 }, { cells: 2, activeTime: 10000 }]) {
      await assert.rejects(operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture, limits: caps }), /strictly increase|greater/i);
      const check = DurableState.openBound(files.checkpoint, before);
      try { assert.deepEqual(check.readTraversal(), original); } finally { check.close(); }
    }
    const resumed = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture, limits: { cells: 2, submissions: 2 } });
    assert.equal(resumed.command, 'resume');
    const check = DurableState.openBound(files.checkpoint, before);
    try {
      assert.equal(check.readTraversal().limits.submissions, 2);
      assert.equal(check.readTraversal().limits.cells, 2);
      assert.equal(check.readTraversal().attempts.length, 1);
      assert.deepEqual(check.readTraversal().blocked.sort(), ['-1,0', '0,-1', '0,1', '1,0']);
      assert.deepEqual(check.readTraversal().queue, []);
    } finally { check.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('cell-cap admitted work drains serially and durable failed results remain partial outcomes', async () => {
  const files = temp();
  try {
    const bytes = fixture({ 'work:0,0': { id: 'job-0', observationId: 'job-0' }, 'work:0,1': { id: 'job-1', observationId: 'job-1' } }, { 'job-0': { result: { status: 'success', candidates: [{ id: 'place' }] }, elapsed: 0 }, 'job-1': { result: { status: 'failed', cause: 'synthetic', scope: 'isolated' }, elapsed: 0 } });
    saveFixture(files.fixture, bytes);
    const result = await operator.start({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: { ...limits, cells: 2 }, onPreflight: preflight });
    assert.equal(result.command, 'start');
    assert.equal(result.status.discoveryGaps.some(gap => gap.cause === 'failed' && gap.scope === 'isolated'), true);
    const durable = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    try {
      assert.equal(durable.readTraversal().attempts.length, 2);
      assert.equal(durable.readTraversal().admitted.length, 2);
      assert.equal(durable.readTraversal().cells['0,1'].outcome, 'failed');
    } finally { durable.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('simultaneous submission and active-time caps stop before send without changing counters', async () => {
  const files = temp();
  try {
    saveFixture(files.fixture, fixture());
    const result = await operator.start({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: { cells: 1, submissions: 0, activeTime: 0 }, onPreflight: preflight });
    assert.equal(result.command, 'start');
    assert.equal(result.status.counters.submissions, 0);
    assert.equal(result.status.counters.activeTime, 0);
    assert.deepEqual(result.status.frontier.queued, ['0,0']);
    const durable = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(fixture()).identity);
    try { assert.deepEqual(durable.readTraversal().attempts, []); } finally { durable.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('known-ID observation remains eligible under both submission and active-time caps', async () => {
  const files = temp();
  const bytes = fixture({}, { 'persisted-id': { result: { status: 'empty' }, elapsed: 50000 } });
  saveFixture(files.fixture, bytes);
  try {
    const identity = operator.parseSyntheticFixture(bytes).identity;
    const state = createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 0 });
    state.queue = [];
    state.cells['0,0'] = { outcome: 'running' };
    state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'observing', knownId: 'persisted-id' }];
    state.submissions = 1;
    DurableState.createBound(files.checkpoint, identity, state);
    let observed = 0;
    const result = await runWithDependencies('resume', { checkpoint: files.checkpoint, fixture: files.fixture }, { send: () => { throw new Error('must not resend'); }, observe: id => { observed++; assert.equal(id, 'persisted-id'); return { result: { status: 'empty' }, elapsed: 50000 }; } });
    assert.equal(result.command, 'resume');
    assert.equal(observed, 1);
    assert.equal(result.status.counters.submissions, 1);
    assert.notEqual(result.status.counters.activeTime, 0);
    const durable = DurableState.openBound(files.checkpoint, identity);
    try { assert.equal(durable.readTraversal().attempts[0].status, 'observed'); } finally { durable.close(); }
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test('resume validates fixture identity before applying any cap increase', async () => {
  const files = temp();
  try {
    const initial = fixture({ 'work:0,0': { id: 'job-0', observationId: 'job-0' } }, { 'job-0': { result: { status: 'empty' }, elapsed: 0 } });
    saveFixture(files.fixture, initial);
    await operator.start({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits: { ...limits, submissions: 1 }, onPreflight: preflight });
    const identity = operator.parseSyntheticFixture(initial).identity;
    const changed = fixture({ 'work:0,0': { id: 'changed', observationId: 'changed' } }, { changed: { result: { status: 'empty' }, elapsed: 0 } });
    saveFixture(files.fixture, changed);
    await assert.rejects(operator.resume({ checkpoint: files.checkpoint, fixture: files.fixture, limits: { submissions: 2 } }), /identity/i);
    const db = DurableState.openBound(files.checkpoint, identity);
    try { assert.equal(db.readTraversal().limits.submissions, 1); } finally { db.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('parked-only unknown-ID uncertainty is typed blocked after the original send failure, without timed invocation or debit', async () => {
  const files = temp();
  const bytes = fixture({ 'work:0,0': { id: 'job-0', observationId: 'job-0' } }, { 'job-0': { result: { status: 'empty' }, elapsed: 0 } });
  saveFixture(files.fixture, bytes);
  let sends = 0;
  let observations = 0;
  try {
    const witness = join(files.directory, 'witness.ndjson');
    const child = spawnSync(process.execPath, ['test/operator-harness.mjs', 'start', JSON.stringify({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits, witness, fault: 'send-throw' })], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /injected send fault/);
    const events = readFileSync(witness, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.type), ['preflight', 'send']);
    sends = 1;
    const identity = operator.parseSyntheticFixture(bytes).identity;
    const prior = DurableState.openBound(files.checkpoint, identity);
    let before;
    try {
      before = prior.readTraversal();
      assert.equal(before.attempts.at(-1).status, 'uncertain');
      assert.equal(before.cells['0,0'].outcome, 'parked');
      assert.equal(before.activeInterval, false);
      assert.equal(before.paused, false);
    } finally { prior.close(); }
    const callsBefore = sends;
    const result = await runWithDependencies('resume', { checkpoint: files.checkpoint, fixture: files.fixture }, { send: () => { sends++; throw new Error('must not send'); }, observe: () => { observations++; return { result: { status: 'empty' }, elapsed: 0 }; } });
    assert.equal(result.command, 'resume');
    assert.equal(result.status.conditions.includes('recovery_pending'), true);
    assert.equal(sends, callsBefore);
    assert.equal(observations, 0);
    assert.equal(result.status.counters.activeTime, before.activeTime);
    const after = DurableState.openBound(files.checkpoint, identity);
    try {
      assert.equal(after.readTraversal().attempts.length, before.attempts.length);
      assert.equal(after.readTraversal().attempts.at(-1).safeRetryAuthorization, undefined);
      assert.equal(after.readTraversal().activeInterval, false);
    } finally { after.close(); }
    assert.equal(Object.hasOwn(publicOperator, 'setOperatorDiscoveryForTest'), false);
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test('isolated parked uncertainty does not prevent other queued discovery work', async () => {
  const files = temp();
  const bytes = fixture({ 'work:0,0': { id: 'job-0', observationId: 'job-0' }, 'work:0,1': { id: 'job-1', observationId: 'job-1' } }, { 'job-0': { result: { status: 'empty' }, elapsed: 0 }, 'job-1': { result: { status: 'empty' }, elapsed: 0 } });
  saveFixture(files.fixture, bytes);
  try {
    const witness = join(files.directory, 'witness.ndjson');
    const child = spawnSync(process.execPath, ['test/operator-harness.mjs', 'start', JSON.stringify({ checkpoint: files.checkpoint, fixture: files.fixture, geometry, limits, witness, fault: 'send-throw' })], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /injected send fault/);
    const identity = operator.parseSyntheticFixture(bytes).identity;
    const db = DurableState.openBound(files.checkpoint, identity);
    try {
      const state = db.readTraversal();
      db.writeTraversal({ ...state, queue: ['0,1'], admitted: [...state.admitted, '0,1'], cells: { ...state.cells, '0,1': { outcome: 'queued' } } });
    } finally { db.close(); }
    let sends = 0;
    const result = await runWithDependencies('resume', { checkpoint: files.checkpoint, fixture: files.fixture }, { send: _workId => { sends++; return { id: 'job-1' }; } });
    assert.equal(result.command, 'resume');
    assert.equal(sends, 1);
    const after = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(bytes).identity);
    try {
      assert.equal(after.readTraversal().attempts.at(-1).cellKey, '0,1');
      assert.equal(after.readTraversal().gaps.some(gap => gap.scope === 'isolated' && gap.status === 'unresolved'), true);
    } finally { after.close(); }
  } finally {
    rmSync(files.directory, { recursive: true, force: true });
  }
});
