import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createTraversal } from '../dist/traversal.js';
import { DurableState } from '../dist/durable-state.js';
import { recordDurableCleanPause } from '../dist/durable-discovery.js';

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
function independentlyRecoverState(path) {
  const db = new DatabaseSync(path);
  try { db.prepare('SELECT count(*) FROM crash_pages').get(); }
  finally { db.close(); }
  return state(path);
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

test('dead-owner clean pause evidence produced through pause path survives bound acquisition without recovery marking', () => {
  const { dir, path } = setup();
  try {
    const paused = DurableState.openBound(path, identity);
    recordDurableCleanPause(paused, 'operator pause');
    paused.close();
    const db = new DatabaseSync(path);
    try { db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(2147483647); }
    finally { db.close(); }
    const acquired = DurableState.openBound(path, identity);
    try {
      const value = acquired.readTraversal();
      assert.equal(value.paused, true);
      assert.deepEqual(value.cleanPauseEvidence, { evidence: 'operator pause' });
      assert.notEqual(value.recoveryPending, true);
      assert.notEqual(value.activeInterval, true);
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
        db.exec('CREATE TABLE crash_pages (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
        const insert = db.prepare('INSERT INTO crash_pages(payload) VALUES(?)');
        for (let page = 0; page < 256; page++) insert.run('baseline-' + String(page).padEnd(4000, 'x'));
        db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(2147483647);
        const value = JSON.parse(db.prepare('SELECT payload FROM traversal').get().payload);
        db.prepare('UPDATE traversal SET payload=?').run(JSON.stringify({ ...value, activeInterval: true, recoveryPending: false }));
      } finally { db.close(); }

      const crash = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { DatabaseSync } from 'node:sqlite';
        const db = new DatabaseSync(process.argv[1]);
        db.exec('PRAGMA cache_size=1; PRAGMA cache_spill=ON; BEGIN IMMEDIATE');
        for (let page = 1; page <= 256; page++) db.prepare('UPDATE crash_pages SET payload=? WHERE id=?').run('uncommitted-' + String(page).padEnd(4000, 'y'), page);
        db.prepare('UPDATE checkpoint SET payload=? WHERE id=1').run('{"version":1,"work":[{"id":"uncommitted","status":"running"}],"observations":[],"gaps":[]}');
        db.prepare('UPDATE traversal SET payload=? WHERE id=1').run('{"uncommitted":true}');
        process.kill(process.pid, 'SIGKILL');
      `, path], { encoding: 'utf8' });
      assert.equal(crash.signal, 'SIGKILL');
      const recoveryFile = `${path}${journalMode === 'DELETE' ? '-journal' : '-wal'}`;
      assert.equal(existsSync(recoveryFile), true);
      const recoveryBytes = readFileSync(recoveryFile);
      if (journalMode === 'DELETE') {
        assert.deepEqual(recoveryBytes.subarray(0, 8), Buffer.from([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]));
        assert.ok(recoveryBytes.length > 28, 'hot rollback journal contains original page records');
      } else {
        assert.ok([0x377f0682, 0x377f0683].includes(recoveryBytes.readUInt32BE(0)), 'WAL header is valid');
        const pageSize = recoveryBytes.readUInt32BE(8);
        const frameSize = pageSize + 24;
        const frameCount = Math.floor((recoveryBytes.length - 32) / frameSize);
        assert.ok(frameCount > 0, 'WAL contains uncommitted transaction frames');
        assert.equal(recoveryBytes.readUInt32BE(32 + (frameCount - 1) * frameSize + 4), 0, 'last WAL frame has no commit marker');
      }

      copyFileSync(path, baselinePath);
      for (const suffix of ['-journal', '-wal', '-shm']) if (existsSync(`${path}${suffix}`)) copyFileSync(`${path}${suffix}`, `${baselinePath}${suffix}`);
      const mainFileBeforeRecovery = readFileSync(baselinePath);
      const recoveredBaseline = independentlyRecoverState(baselinePath);
      if (journalMode === 'DELETE') assert.notDeepEqual(readFileSync(baselinePath), mainFileBeforeRecovery, 'hot rollback recovery restores the modified main database pages');
      assert.equal(JSON.parse(recoveredBaseline.checkpoint).work.length, 0);
      const recoveredTraversal = JSON.parse(recoveredBaseline.traversal);
      assert.equal(recoveredTraversal.activeInterval, true);
      assert.notEqual(recoveredTraversal.recoveryPending, true);
      assert.deepEqual(recoveredTraversal.limits, traversal().limits);
      assert.equal(recoveredBaseline.owner, 2147483647);

      assert.throws(() => DurableState.openBound(path, otherIdentity), /fixture|binding|identity/i);
      assert.deepEqual(state(path), recoveredBaseline);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('identical fixture bytes loaded from alternate paths open the same bound checkpoint', () => {
  const bytes = Buffer.from('{"version":1,"discoveries":{},"observations":{}}');
  const dir = mkdtempSync(join(tmpdir(), 'crawler-binding-path-'));
  try {
    const checkpoint = join(dir, 'checkpoint.db');
    const firstFixture = join(dir, 'fixtures', 'first.json');
    const secondFixture = join(dir, 'alternate', 'second.json');
    for (const fixturePath of [firstFixture, secondFixture]) {
      const fixtureDir = fixturePath.slice(0, fixturePath.lastIndexOf('/'));
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(fixturePath, bytes);
    }
    const firstIdentity = createHash('sha256').update(readFileSync(firstFixture)).digest('hex');
    const alternateIdentity = createHash('sha256').update(readFileSync(secondFixture)).digest('hex');
    assert.equal(alternateIdentity, firstIdentity);
    DurableState.createBound(checkpoint, firstIdentity, traversal());
    const acquired = DurableState.openBound(checkpoint, alternateIdentity);
    acquired.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
