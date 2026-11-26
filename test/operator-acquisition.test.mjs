import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createTraversal } from '../dist/traversal.js';
import { DurableState, setBeforePublishForTest } from '../dist/durable-state.js';

const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'crawler-acquisition-')); return { dir, path: join(dir, 'state.db') }; };
const identity = 'a'.repeat(64);
const traversal = () => createTraversal({ seed: { latitude: 0, longitude: 0 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 5, submissions: 5, activeTime: 10000 });

test('bound checkpoint is fully initialized and fixture-bound before publication', () => {
  const { dir, path } = temp();
  try {
    DurableState.createBound(path, identity, traversal());
    assert.equal(existsSync(path), true);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual({ ...db.prepare('SELECT version, payload FROM checkpoint').get() }, { version: 1, payload: '{"version":1,"work":[],"observations":[],"gaps":[]}' });
      assert.deepEqual({ ...db.prepare('SELECT payload FROM operator_binding').get() }, { payload: JSON.stringify({ version: 1, fixtureIdentity: identity }) });
      assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='owner'").get().name, 'owner');
      assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM traversal').get().payload), traversal());
    } finally { db.close(); }
    assert.throws(() => DurableState.open(path), /operator-bound|bound checkpoint/i);
    const after = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(after.prepare('SELECT pid FROM owner').get(), undefined);
      assert.deepEqual(JSON.parse(after.prepare('SELECT payload FROM traversal').get().payload), traversal());
    } finally { after.close(); }
    const names = readdirSync(dir);
    assert.deepEqual(names, ['state.db']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bound publication never replaces an existing destination', () => {
  const { dir, path } = temp();
  try {
    writeFileSync(path, 'operator-owned');
    assert.throws(() => DurableState.createBound(path, identity, traversal()), /exist|publish/i);
    assert.equal(readFileSync(path, 'utf8'), 'operator-owned');
    assert.deepEqual(readdirSync(dir), ['state.db']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('process interruption before bound publication leaves only private staging', () => {
  const { dir, path } = temp();
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { DurableState, setBeforePublishForTest } from ${JSON.stringify(new URL('../dist/durable-state.js', import.meta.url).href)}; setBeforePublishForTest(() => process.exit(78)); DurableState.createBound(${JSON.stringify(path)}, ${JSON.stringify(identity)}, ${JSON.stringify(traversal())});`], { encoding: 'utf8' });
    assert.equal(child.status, 78, child.stderr);
    assert.equal(existsSync(path), false);
    assert.equal(readdirSync(dir).length, 1);
    assert.match(readdirSync(dir)[0], /^\.state\.db\.init-/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a handled pre-publication failure cleans only its staging directory', () => {
  const { dir, path } = temp();
  try {
    setBeforePublishForTest(() => { throw new Error('injected before publication'); });
    assert.throws(() => DurableState.createBound(path, identity, traversal()), /injected before publication/);
    assert.equal(existsSync(path), false);
    assert.deepEqual(readdirSync(dir), []);
  } finally { setBeforePublishForTest(undefined); rmSync(dir, { recursive: true, force: true }); }
});

test('orphan sidecars prevent bound publication and remain untouched', () => {
  const { dir, path } = temp();
  try {
    writeFileSync(`${path}-wal`, 'orphan');
    assert.throws(() => DurableState.createBound(path, identity, traversal()), /orphan SQLite sidecar/i);
    assert.equal(existsSync(path), false);
    assert.equal(readFileSync(`${path}-wal`, 'utf8'), 'orphan');
    assert.deepEqual(readdirSync(dir), ['state.db-wal']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a destination published before interruption is complete and cannot be replaced', () => {
  const { dir, path } = temp();
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { DurableState, setAfterCreateForTest } from ${JSON.stringify(new URL('../dist/durable-state.js', import.meta.url).href)}; setAfterCreateForTest(() => process.exit(77)); DurableState.createBound(${JSON.stringify(path)}, ${JSON.stringify(identity)}, ${JSON.stringify(traversal())});`], { encoding: 'utf8' });
    assert.equal(child.status, 77, child.stderr);
    assert.equal(existsSync(path), true);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual({ ...db.prepare('SELECT payload FROM operator_binding').get() }, { payload: JSON.stringify({ version: 1, fixtureIdentity: identity }) });
      assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM traversal').get().payload), traversal());
    } finally { db.close(); }
    assert.throws(() => DurableState.createBound(path, 'b'.repeat(64), traversal()), /exist|publish/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
