import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { previewProviderResume } from '../dist/provider-preview.js';
import { runSyntheticOperator } from '../dist/synthetic-bright-data-operator.js';

const geometry = { seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } };
const limits = { cells: 5, submissions: 5, activeTime: 10000 };
const binding = { version: 2, mode: 'bright-data', keyword: 'cafe', country: 'GB', zoom: 15, limitPerInput: 20 };
function withDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'resume-preview-')); const path = join(dir, 'checkpoint.db');
  try { DurableState.createBound(path, binding, createTraversal(geometry, limits)); fn(path); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function rows(path) { const db = new DatabaseSync(path, { readOnly: true }); try { return ['checkpoint', 'operator_binding', 'traversal', 'owner'].map(t => db.prepare(`SELECT * FROM ${t}`).all()); } finally { db.close(); } }
test('resume preview uses bound state and effective increased limits without mutation', () => withDb(path => {
  const before = rows(path); const result = previewProviderResume(path, { submissions: 9 });
  assert.deepEqual(result.limits, { ...limits, submissions: 9 });
  assert.deepEqual(result.binding, binding); assert.deepEqual(result.geometry, geometry);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/); assert.deepEqual(result.knownIds, []); assert.deepEqual(result.gaps, []);
  assert.equal(result.authorization, 'not-authorized');
  assert.notEqual(result.fingerprint, previewProviderResume(path).fingerprint);
  assert.deepEqual(rows(path), before);
}));
test('invalid limits and corrupt or fixture bindings fail closed', () => withDb(path => {
  for (const invalid of [{ cells: 5 }, { submissions: 4 }, { activeTime: 1.5 }, { extra: 9 }, null]) assert.throws(() => previewProviderResume(path, invalid));
  const db = new DatabaseSync(path);
  try {
    db.prepare('UPDATE operator_binding SET payload=?').run(JSON.stringify({ ...binding, country: 'bad' }));
    assert.throws(() => previewProviderResume(path), /binding/);
    db.prepare('UPDATE operator_binding SET payload=?').run(JSON.stringify(binding));
    db.prepare('UPDATE traversal SET payload=?').run('{bad');
    assert.throws(() => previewProviderResume(path));
    db.prepare('UPDATE operator_binding SET payload=?').run(JSON.stringify({ version: 1, fixtureIdentity: 'a'.repeat(64) }));
    assert.throws(() => previewProviderResume(path));
  } finally { db.close(); }
}));
test('preview retains known provider ID and actionable gap from a synthetic failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'resume-preview-')); const path = join(dir, 'checkpoint.db');
  try {
    let calls = 0;
    const transport = { submit: async () => { calls++; return { status: 202, body: { snapshot_id: 'synthetic-id' } }; }, observe: async () => { calls++; return { status: 200, body: { status: 'ready' } }; }, retrieve: async () => { calls++; return { status: 500, body: {} }; } };
    const bounds = { requestMilliseconds: 1000, activeUntil: Date.now() + 10000, maxObservations: 1, observationDeadline: Date.now() + 10000 };
    await runSyntheticOperator('start', { checkpoint: path, geometry, binding, limits, bounds }, transport);
    const before = rows(path); const count = calls; const preview = previewProviderResume(path);
    assert.equal(preview.knownIds[0].id, 'synthetic-id'); assert.ok(preview.gaps.length > 0);
    assert.equal(calls, count); assert.deepEqual(rows(path), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('preview limits match effective synthetic resume and preview performs no transport', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'resume-preview-')); const path = join(dir, 'checkpoint.db');
  try {
    DurableState.createBound(path, binding, createTraversal(geometry, limits));
    let calls = 0;
    const transport = { submit: async () => { calls++; throw Error('unexpected'); }, observe: async () => { calls++; throw Error('unexpected'); }, retrieve: async () => { calls++; throw Error('unexpected'); } };
    const before = rows(path); const preview = previewProviderResume(path, { submissions: 9 });
    assert.equal(calls, 0); assert.deepEqual(rows(path), before);
    const bounds = { requestMilliseconds: 1000, activeUntil: Date.now() + 10000, maxObservations: 1, observationDeadline: Date.now() + 10000 };
    // Pause the queued checkpoint so resume persists limits without sending.
    const db = new DatabaseSync(path); const row = db.prepare('SELECT payload FROM traversal').get(); const state = JSON.parse(row.payload); state.paused = true; db.prepare('UPDATE traversal SET payload=?').run(JSON.stringify(state)); db.close();
    const updatedPreview = previewProviderResume(path, { submissions: 9 });
    assert.notEqual(preview.fingerprint, updatedPreview.fingerprint);
    const resumed = await runSyntheticOperator('resume', { checkpoint: path, geometry, binding, limits: { submissions: 9 }, bounds }, transport);
    assert.deepEqual(resumed.status.limits, updatedPreview.limits); assert.equal(calls, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
