import test from 'node:test';
import assert from 'node:assert/strict';
import * as operator from '../dist/operator.js';
import { DatabaseSync } from 'node:sqlite';
import { DurableState, setAfterTraversalWriteForTest } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const geometry = { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 300 } };
const limits = { cells: 5, submissions: 10, activeTime: 10000 };
const fixture = Buffer.from(JSON.stringify({
  version: 1,
  discoveries: Object.fromEntries(['0,0', '0,1', '0,-1', '1,0', '-1,0'].map(key => [`work:${key}`, { id: key, observationId: key }])),
  observations: Object.fromEntries(['0,0', '0,1', '0,-1', '1,0', '-1,0'].map(key => [key, { result: { status: key === '0,0' ? 'success' : 'empty', ...(key === '0,0' ? { candidates: [{ id: 'place' }] } : {}) }, elapsed: 4 }]))
}));
const traversalFromDb = path => {
  const db = new DatabaseSync(path);
  try { return JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); } finally { db.close(); }
};
const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-cancel-'));
  const checkpoint = join(directory, 'state.db');
  const fixturePath = join(directory, 'fixture.json');
  writeFileSync(fixturePath, fixture);
  return { directory, checkpoint, fixturePath };
};

test('timer abort from first send runs before second eligible operation and settles then cancels', async () => {
  const files = setup();
  const controller = new AbortController();
  const sent = [];
  const observed = [];
  try {
    operator.setOperatorDiscoveryForTest({
      send: id => { sent.push(id); if (sent.length === 1) setTimeout(() => controller.abort(), 0); return { id: id.slice(5) }; },
      observe: id => { observed.push(id); return { result: { status: id === '0,0' ? 'success' : 'empty', ...(id === '0,0' ? { candidates: [{ id: 'place' }] } : {}) }, elapsed: 4 }; }
    });
    const result = await operator.start({ checkpoint: files.checkpoint, fixture: files.fixturePath, geometry, limits, onPreflight() {}, signal: controller.signal });
    assert.equal(sent.length, 1);
    assert.deepEqual(observed, ['0,0']);
    assert.equal(result.status.state, 'cancelled');
    assert.equal(result.status.conditions.includes('cancelled'), true);
    assert.equal(result.status.counters.activeTime > 0, true);
    const db = DurableState.openBound(files.checkpoint, operator.parseSyntheticFixture(fixture).identity);
    try {
      const persisted = db.readTraversal();
      assert.equal(persisted.cancelled, true);
      assert.equal(persisted.activeInterval, false);
      assert.equal(persisted.activeTime, result.status.counters.activeTime);
    } finally { db.close(); }
  } finally { operator.setOperatorDiscoveryForTest(undefined); rmSync(files.directory, { recursive: true, force: true }); }
});

test('pre-aborted run durably cancels before submitting work', async () => {
  const files = setup();
  const controller = new AbortController();
  controller.abort();
  let sends = 0;
  try {
    operator.setOperatorDiscoveryForTest({ send: () => { sends++; throw new Error('must not submit'); } });
    const result = await operator.start({ checkpoint: files.checkpoint, fixture: files.fixturePath, geometry, limits, onPreflight() {}, signal: controller.signal });
    assert.equal(sends, 0);
    assert.equal(result.command, 'start');
    assert.equal(result.status.conditions.includes('cancelled'), true);
    assert.equal(result.status.counters.submissions, 0);
    assert.equal(result.status.counters.activeTime, 0);
  } finally { operator.setOperatorDiscoveryForTest(undefined); rmSync(files.directory, { recursive: true, force: true }); }
});

test('cancel-only acquisition reconciles orphan interval before cancel and preserves unresolved accounting', () => {
  const files = setup();
  try {
    const identity = operator.parseSyntheticFixture(fixture).identity;
    const state = createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 });
    state.activeInterval = true;
    state.submissions = 1;
    state.cells['0,0'] = { outcome: 'running' };
    state.queue = [];
    state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', safeRetryAuthorization: { ordinal: 1, ceiling: 1, delayMs: 12 } }];
    DurableState.createBound(files.checkpoint, identity, state);
    const db = new DatabaseSync(files.checkpoint);
    db.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(2147483647);
    db.close();
    const cancelled = operator.cancelCheckpoint({ checkpoint: files.checkpoint });
    assert.equal(cancelled.command, 'cancel');
    const persisted = traversalFromDb(files.checkpoint);
    assert.equal(persisted.cancelled, true);
    assert.equal(persisted.recoveryPending, true);
    assert.equal(persisted.activeInterval, false);
    assert.equal(persisted.submissions, 1);
    assert.deepEqual(persisted.attempts[0].safeRetryAuthorization, { ordinal: 1, ceiling: 1, delayMs: 12 });
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('cancel-only acquisition cancels a paused checkpoint and preserves recovery state', () => {
  const files = setup();
  try {
    const identity = operator.parseSyntheticFixture(fixture).identity;
    const state = createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 });
    state.paused = true;
    state.recoveryPending = true;
    DurableState.createBound(files.checkpoint, identity, state);
    const cancelled = operator.cancelCheckpoint({ checkpoint: files.checkpoint });
    assert.equal(cancelled.command, 'cancel');
    const persisted = traversalFromDb(files.checkpoint);
    assert.equal(persisted.cancelled, true);
    assert.equal(persisted.paused, true);
    assert.equal(persisted.recoveryPending, true);
    assert.notEqual(persisted.activeInterval, true);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('cancel-only acquisition refuses a live owner without changing logical state', () => {
  const files = setup();
  try {
    const identity = operator.parseSyntheticFixture(fixture).identity;
    DurableState.createBound(files.checkpoint, identity, createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const db = new DatabaseSync(files.checkpoint);
    db.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(process.pid);
    const before = db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload;
    db.close();
    assert.throws(() => operator.cancelCheckpoint({ checkpoint: files.checkpoint }), /already owned/);
    const check = new DatabaseSync(files.checkpoint);
    try { assert.equal(check.prepare('SELECT payload FROM traversal WHERE id=1').get().payload, before); } finally { check.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('standalone idle cancellation changes only the cancellation flag', () => {
  const files = setup();
  try {
    const state = createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 });
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(fixture).identity, state);
    const cancelled = operator.cancelCheckpoint({ checkpoint: files.checkpoint });
    assert.equal(cancelled.command, 'cancel');
    const persisted = traversalFromDb(files.checkpoint);
    assert.equal(persisted.cancelled, true);
    assert.equal(persisted.paused, false);
    assert.equal(persisted.submissions, state.submissions);
    assert.equal(persisted.activeTime, state.activeTime);
    assert.deepEqual(persisted.queue, state.queue);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('cancel-only writer claim failure leaves state unchanged', () => {
  const files = setup();
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(fixture).identity, createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const lock = new DatabaseSync(files.checkpoint);
    lock.exec('BEGIN IMMEDIATE');
    try { assert.throws(() => operator.cancelCheckpoint({ checkpoint: files.checkpoint }), /locked|busy/i); }
    finally { lock.exec('ROLLBACK'); lock.close(); }
    const check = new DatabaseSync(files.checkpoint);
    try { assert.equal(JSON.parse(check.prepare('SELECT payload FROM traversal WHERE id=1').get().payload).cancelled, false); } finally { check.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('cancel-only acquisition rejects malformed binding without changing traversal', () => {
  const files = setup();
  try {
    const identity = operator.parseSyntheticFixture(fixture).identity;
    DurableState.createBound(files.checkpoint, identity, createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const db = new DatabaseSync(files.checkpoint);
    db.prepare('UPDATE operator_binding SET payload=? WHERE id=1').run('{"version":1,"fixtureIdentity":"bad"}');
    const before = db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload;
    db.close();
    assert.throws(() => operator.cancelCheckpoint({ checkpoint: files.checkpoint }), /binding/);
    const check = new DatabaseSync(files.checkpoint);
    try { assert.equal(check.prepare('SELECT payload FROM traversal WHERE id=1').get().payload, before); } finally { check.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('known-ID pending observation consumes its delay and remains eligible at both caps without resubmission', async () => {
  const files = setup();
  const identity = operator.parseSyntheticFixture(fixture).identity;
  const state = createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 0 });
  state.queue = [];
  state.cells['0,0'] = { outcome: 'running' };
  state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'observing', knownId: '0,0', retryOrdinal: 1, observationRetryCeiling: 2, observationRetryPendingDelayMs: 0 }];
  state.submissions = 1;
  DurableState.createBound(files.checkpoint, identity, state);
  let sends = 0, observations = 0;
  try {
    operator.setOperatorDiscoveryForTest({ send: () => { sends++; throw new Error('must not resend'); }, observe: id => { observations++; assert.equal(id, '0,0'); return { result: { status: 'empty' }, elapsed: 1 }; } });
    const result = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixturePath });
    assert.equal(result.command, 'resume');
    const persisted = traversalFromDb(files.checkpoint);
    assert.equal(persisted.attempts[0].status, 'observed');
    assert.equal(persisted.attempts[0].retryOrdinal, 1);
    assert.equal(persisted.attempts[0].observationRetryCeiling, 2);
    assert.equal(Object.hasOwn(persisted.attempts[0], 'observationRetryPendingDelayMs'), false);
    assert.equal(persisted.submissions, 1);
    assert.equal(sends, 0);
    assert.equal(observations, 1);
  } finally { operator.setOperatorDiscoveryForTest(undefined); rmSync(files.directory, { recursive: true, force: true }); }
});

test('refused unknown-ID safe-retry retains authorization and calls no callbacks when cancellation is requested', async () => {
  const files = setup();
  const identity = operator.parseSyntheticFixture(fixture).identity;
  const state = createTraversal(geometry, { cells: 1, submissions: 2, activeTime: 100 });
  state.queue = [];
  state.cells['0,0'] = { outcome: 'running' };
  state.attempts = [{ id: 'work:0,0:attempt:1', workId: 'work:0,0', cellKey: '0,0', status: 'uncertain', safeRetryAuthorization: { ordinal: 1, ceiling: 1, delayMs: 20 } }];
  state.submissions = 1;
  DurableState.createBound(files.checkpoint, identity, state);
  const controller = new AbortController();
  controller.abort();
  let sends = 0, observations = 0;
  try {
    operator.setOperatorDiscoveryForTest({ send: () => { sends++; throw new Error('must not send'); }, observe: () => { observations++; throw new Error('must not observe'); } });
    const result = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixturePath, signal: controller.signal });
    assert.equal(result.status.conditions.includes('cancelled'), true);
    const persisted = traversalFromDb(files.checkpoint);
    assert.equal(persisted.cancelled, true);
    assert.deepEqual(persisted.attempts[0].safeRetryAuthorization, { ordinal: 1, ceiling: 1, delayMs: 20 });
    assert.equal(sends, 0);
    assert.equal(observations, 0);
  } finally { operator.setOperatorDiscoveryForTest(undefined); rmSync(files.directory, { recursive: true, force: true }); }
});

test('settlement failure remains an error and is not converted to cancellation', async () => {
  const files = setup();
  const settlementError = new Error('settlement failed');
  const controller = new AbortController();
  try {
    operator.setOperatorDiscoveryForTest({ send: id => { setTimeout(() => controller.abort(), 0); return { id: id.slice(5) }; }, observe: () => {
      setAfterTraversalWriteForTest(() => { throw settlementError; });
      return { result: { status: 'empty' }, elapsed: 1 };
    } });
    await assert.rejects(operator.start({ checkpoint: files.checkpoint, fixture: files.fixturePath, geometry, limits: { ...limits, cells: 1 }, onPreflight() {}, signal: controller.signal }), error => error === settlementError);
  } finally {
    setAfterTraversalWriteForTest(undefined);
    operator.setOperatorDiscoveryForTest(undefined);
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test('cancel-only acquisition rejects an unbound checkpoint', () => {
  const files = setup();
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(fixture).identity, createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const db = new DatabaseSync(files.checkpoint);
    db.exec('DROP TABLE operator_binding');
    db.close();
    assert.throws(() => operator.cancelCheckpoint({ checkpoint: files.checkpoint }), /schema/);
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('resume abort cancellation uses the retained writer lease', async () => {
  const files = setup();
  const controller = new AbortController();
  const originalAcquire = DurableState.acquireCancelOnly;
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(fixture).identity, createTraversal(geometry, { ...limits, cells: 1 }));
    operator.setOperatorDiscoveryForTest({ send: id => { setTimeout(() => controller.abort(), 0); return { id: id.slice(5) }; } });
    DurableState.acquireCancelOnly = () => { throw new Error('must retain the original writer lease'); };
    const result = await operator.resume({ checkpoint: files.checkpoint, fixture: files.fixturePath, signal: controller.signal });
    assert.equal(result.status.state, 'cancelled');
    assert.equal(result.status.conditions.includes('cancelled'), true);
    assert.equal(result.status.counters.activeTime > 0, true);
  } finally {
    DurableState.acquireCancelOnly = originalAcquire;
    operator.setOperatorDiscoveryForTest(undefined);
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test('cancel-only acquisition has runtime-private writer storage', () => {
  const files = setup();
  try {
    DurableState.createBound(files.checkpoint, operator.parseSyntheticFixture(fixture).identity, createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const acquisition = DurableState.acquireCancelOnly(files.checkpoint);
    try {
      assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(acquisition)).sort(), ['cancel', 'close', 'constructor', 'releaseOwner', 'snapshot']);
      assert.deepEqual(Object.getOwnPropertyNames(acquisition), []);
      assert.equal('db' in acquisition, false);
    } finally { acquisition.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('cancel-only cancellation trusts stored state rather than a replaced snapshot method', () => {
  const files = setup();
  try {
    const identity = operator.parseSyntheticFixture(fixture).identity;
    DurableState.createBound(files.checkpoint, identity, createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const acquisition = DurableState.acquireCancelOnly(files.checkpoint);
    const stored = acquisition.snapshot();
    const active = { ...stored, activeInterval: true };
    const db = new DatabaseSync(files.checkpoint);
    db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify(active));
    db.close();
    acquisition.snapshot = () => ({ ...stored, limits: { ...stored.limits, cells: stored.limits.cells + 1 } });
    try {
      assert.throws(() => acquisition.cancel(), /active interval/);
      const check = new DatabaseSync(files.checkpoint);
      try {
        const row = check.prepare('SELECT payload FROM traversal WHERE id=1').get();
        assert.deepEqual(JSON.parse(String(row.payload)), active);
      } finally { check.close(); }
    } finally { acquisition.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('cancel-only acquisition cannot bypass the guarded traversal transition', () => {
  const files = setup();
  try {
    const identity = operator.parseSyntheticFixture(fixture).identity;
    DurableState.createBound(files.checkpoint, identity, createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const acquisition = DurableState.acquireCancelOnly(files.checkpoint);
    const exposedWriter = acquisition.db;
    if (exposedWriter) exposedWriter.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...acquisition.snapshot(), cancelled: true }));
    acquisition.close();
    const check = DurableState.openBound(files.checkpoint, identity);
    try { assert.equal(check.readTraversal().cancelled, false); } finally { check.close(); }
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
});

test('in-run abort cancellation uses the retained writer lease', async () => {
  const files = setup();
  const controller = new AbortController();
  const originalAcquire = DurableState.acquireCancelOnly;
  try {
    operator.setOperatorDiscoveryForTest({ send: id => { setTimeout(() => controller.abort(), 0); return { id: id.slice(5) }; } });
    DurableState.acquireCancelOnly = () => { throw new Error('must retain the original writer lease'); };
    const result = await operator.start({ checkpoint: files.checkpoint, fixture: files.fixturePath, geometry, limits: { ...limits, cells: 1 }, onPreflight() {}, signal: controller.signal });
    assert.equal(result.status.state, 'cancelled');
    assert.equal(result.status.conditions.includes('cancelled'), true);
    assert.equal(result.status.counters.activeTime > 0, true);
  } finally {
    DurableState.acquireCancelOnly = originalAcquire;
    operator.setOperatorDiscoveryForTest(undefined);
    rmSync(files.directory, { recursive: true, force: true });
  }
});
