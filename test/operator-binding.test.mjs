import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createTraversal } from '../dist/traversal.js';
import { DurableState } from '../dist/durable-state.js';

const identity = 'a'.repeat(64);
const otherIdentity = 'b'.repeat(64);
const traversal = () => createTraversal({ seed: { latitude: 0, longitude: 0 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 5, submissions: 5, activeTime: 10000 });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'crawler-binding-'));
  const path = join(dir, 'state.db');
  DurableState.createBound(path, identity, traversal());
  return { dir, path };
}
function state(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    return {
      binding: tables.has('operator_binding') ? db.prepare('SELECT payload FROM operator_binding').get()?.payload : undefined,
      checkpoint: db.prepare('SELECT payload FROM checkpoint').get()?.payload,
      owner: db.prepare('SELECT pid FROM owner').get()?.pid,
      traversal: db.prepare('SELECT payload FROM traversal').get()?.payload,
    };
  } finally { db.close(); }
}

test('bound acquisition rejects a mismatched fixture without logical application mutation', () => {
  const { dir, path } = setup();
  try {
    const before = state(path);
    assert.throws(() => DurableState.openBound(path, otherIdentity), /fixture|binding|identity/i);
    assert.deepEqual(state(path), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bound acquisition validates identity before refusing a live owner', () => {
  const { dir, path } = setup();
  try {
    const db = new DatabaseSync(path);
    try { db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(process.pid); }
    finally { db.close(); }
    const before = state(path);
    assert.throws(() => DurableState.openBound(path, otherIdentity), /fixture|binding|identity/i);
    assert.deepEqual(state(path), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bound acquisition retains its validated connection and marks dead-owner interruption for recovery', () => {
  const { dir, path } = setup();
  try {
    const db = new DatabaseSync(path);
    try {
      db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(2147483647);
      const value = JSON.parse(db.prepare('SELECT payload FROM traversal').get().payload);
      db.prepare('UPDATE traversal SET payload=?').run(JSON.stringify({ ...value, activeInterval: true }));
    } finally { db.close(); }
    const acquired = DurableState.openBound(path, identity);
    try {
      const value = acquired.readTraversal();
      assert.equal(value.recoveryPending, true);
      assert.equal(value.activeInterval, false);
      assert.throws(() => acquired.beginActiveInterval(), /cannot begin/i);
      assert.equal(state(path).owner, process.pid);
    } finally { acquired.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bound acquisition rejects an unbound legacy checkpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crawler-binding-'));
  const path = join(dir, 'state.db');
  try {
    const legacy = DurableState.open(path);
    legacy.close();
    const before = state(path);
    assert.throws(() => DurableState.openBound(path, identity), /bound|binding|fixture/i);
    assert.deepEqual(state(path), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dead-owner clean pause evidence survives bound acquisition without recovery marking', () => {
  const { dir, path } = setup();
  try {
    const db = new DatabaseSync(path);
    try {
      db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(2147483647);
      const value = JSON.parse(db.prepare('SELECT payload FROM traversal').get().payload);
      db.prepare('UPDATE traversal SET payload=?').run(JSON.stringify({ ...value, paused: true, cleanPauseEvidence: { evidence: 'operator pause' }, activeInterval: false, recoveryPending: false }));
    } finally { db.close(); }
    const acquired = DurableState.openBound(path, identity);
    try {
      const value = acquired.readTraversal();
      assert.equal(value.paused, true);
      assert.deepEqual(value.cleanPauseEvidence, { evidence: 'operator pause' });
      assert.equal(value.recoveryPending, false);
      assert.equal(value.activeInterval, false);
      assert.equal(state(path).owner, process.pid);
    } finally { acquired.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const journalMode of ['DELETE', 'WAL']) {
  test(`mismatched fixture preserves logical state after genuine crashed ${journalMode} recovery`, () => {
    const { dir, path } = setup();
    const baselinePath = join(dir, 'recovered-baseline.db');
    try {
      const db = new DatabaseSync(path);
      try {
        db.exec(`PRAGMA journal_mode=${journalMode}`);
        db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(2147483647);
        const value = JSON.parse(db.prepare('SELECT payload FROM traversal').get().payload);
        db.prepare('UPDATE traversal SET payload=?').run(JSON.stringify({ ...value, activeInterval: true, recoveryPending: false }));
      } finally { db.close(); }

      const crash = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { DatabaseSync } from 'node:sqlite';
        const db = new DatabaseSync(process.argv[1]);
        db.exec('BEGIN IMMEDIATE');
        db.prepare('UPDATE checkpoint SET payload=? WHERE id=1').run('{"version":1,"work":[{"id":"uncommitted","status":"running"}],"observations":[],"gaps":[]}');
        db.prepare('UPDATE traversal SET payload=? WHERE id=1').run('{"uncommitted":true}');
        process.kill(process.pid, 'SIGKILL');
      `, path], { encoding: 'utf8' });
      assert.equal(crash.signal, 'SIGKILL');
      assert.equal(existsSync(`${path}${journalMode === 'DELETE' ? '-journal' : '-wal'}`), true);

      copyFileSync(path, baselinePath);
      for (const suffix of ['-journal', '-wal', '-shm']) if (existsSync(`${path}${suffix}`)) copyFileSync(`${path}${suffix}`, `${baselinePath}${suffix}`);
      const recoveredBaseline = state(baselinePath);
      assert.equal(JSON.parse(recoveredBaseline.checkpoint).work.length, 0);
      assert.equal(JSON.parse(recoveredBaseline.traversal).activeInterval, true);
      assert.equal(recoveredBaseline.owner, 2147483647);

      let sends = 0;
      const send = () => { sends++; };
      assert.throws(() => {
        DurableState.openBound(path, otherIdentity);
        send();
      }, /fixture|binding|identity/i);
      assert.equal(sends, 0);
      assert.deepEqual(state(path), recoveredBaseline);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('identical fixture bytes bind checkpoints independently of fixture path', () => {
  const bytes = Buffer.from('{"version":1,"discoveries":{},"observations":{}}');
  const fixtureIdentity = createHash('sha256').update(bytes).digest('hex');
  const dir = mkdtempSync(join(tmpdir(), 'crawler-binding-path-'));
  try {
    const first = join(dir, 'first.db');
    const second = join(dir, 'second.db');
    DurableState.createBound(first, fixtureIdentity, traversal());
    DurableState.createBound(second, createHash('sha256').update(Buffer.from(bytes)).digest('hex'), traversal());
    const acquired = DurableState.openBound(second, fixtureIdentity);
    acquired.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
