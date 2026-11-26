import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { DurableState } from '../dist/durable-state.js';
import { recordDurableCleanPause } from '../dist/durable-discovery.js';
import { createTraversal, validateGeometry } from '../dist/index.js';
import * as operator from '../dist/operator.js';

const cli = new URL('../dist/cli.js', import.meta.url);
const geometry = { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 200 } };

test('status and export reject a missing checkpoint without creating it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-'));
  const checkpoint = join(directory, 'missing.db');
  try {
    assert.throws(() => operator.status({ checkpoint }));
    assert.throws(() => operator.exportResults({ checkpoint }));
    assert.equal(existsSync(checkpoint), false);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI exposes status and export and rejects missing checkpoints with empty stdout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-cli-'));
  try {
    for (const command of ['status', 'export']) {
      const result = spawnSync(process.execPath, [new URL(cli).pathname, command, '--checkpoint', join(directory, 'missing.db')], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /unable to open database file/i);
    }
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('read-only status reports the exact document for a stale owner with genuine clean-pause evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-stale-pause-'));
  const checkpoint = join(directory, 'state.db');
  const fixtureBytes = Buffer.from('synthetic fixture identity');
  try {
    const fixtureIdentity = createHash('sha256').update(fixtureBytes).digest('hex');
    DurableState.createBound(checkpoint, fixtureIdentity, createTraversal(validateGeometry(geometry), { cells: 1, submissions: 2, activeTime: 100 }));
    const state = DurableState.openBound(checkpoint, fixtureIdentity);
    try { recordDurableCleanPause(state, 'synthetic operator-confirmed clean pause'); } finally { state.close(); }
    const raw = new DatabaseSync(checkpoint);
    raw.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(2147483647);
    raw.close();
    assert.deepEqual(operator.status({ checkpoint }), {
      version: 1, state: 'paused', headline: 'paused', conditions: ['paused'],
      geometry: { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 200 } },
      limits: { cells: 1, submissions: 2, activeTime: 100 },
      counters: { admitted: 1, submissions: 0, activeTime: 0 },
      frontier: { queued: ['0,0'], running: [], parked: [], blocked: [], discoveryExhausted: false },
      discoveryGaps: [], detailGaps: [], pendingDetails: [],
      coverage: { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false },
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('CLI emits successful status and export documents for an existing checkpoint', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-cli-success-'));
  const checkpoint = join(directory, 'state.db');
  const fixtureIdentity = createHash('sha256').update('synthetic fixture identity').digest('hex');
  try {
    DurableState.createBound(checkpoint, fixtureIdentity, createTraversal(validateGeometry(geometry), { cells: 1, submissions: 2, activeTime: 100 }));
    for (const command of ['status', 'export']) {
      const result = spawnSync(process.execPath, [new URL(cli).pathname, command, '--checkpoint', checkpoint], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      const document = JSON.parse(result.stdout);
      if (command === 'status') assert.deepEqual(document, operator.status({ checkpoint }));
      else assert.deepEqual(document, operator.exportResults({ checkpoint }));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('read-only inspection rejects unsupported and corrupt checkpoints without repairing them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-corrupt-'));
  const checkpoint = join(directory, 'state.db');
  const fixtureIdentity = createHash('sha256').update('synthetic fixture identity').digest('hex');
  try {
    DurableState.createBound(checkpoint, fixtureIdentity, createTraversal(validateGeometry(geometry), { cells: 1, submissions: 2, activeTime: 100 }));
    const db = new DatabaseSync(checkpoint);
    try {
      db.prepare('UPDATE checkpoint SET version=99 WHERE id=1').run();
      assert.throws(() => operator.status({ checkpoint }), /Unsupported or missing checkpoint schema version/);
      assert.equal(db.prepare('SELECT version FROM checkpoint WHERE id=1').get().version, 99);
      db.prepare('UPDATE checkpoint SET version=1 WHERE id=1').run();
      db.prepare('UPDATE traversal SET payload=? WHERE id=1').run('{');
      assert.throws(() => operator.exportResults({ checkpoint }));
      assert.equal(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload, '{');
    } finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('status reports every simultaneous v1 condition with the required headline precedence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-conditions-'));
  const checkpoint = join(directory, 'state.db');
  const fixtureIdentity = createHash('sha256').update('synthetic fixture identity').digest('hex');
  try {
    DurableState.createBound(checkpoint, fixtureIdentity, createTraversal(validateGeometry(geometry), { cells: 1, submissions: 2, activeTime: 100 }));
    const db = new DatabaseSync(checkpoint);
    const state = JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
    state.limits.submissions = 0;
    state.limits.activeTime = 0;
    Object.assign(state, { submissions: 0, activeTime: 0, activeInterval: true, recoveryPending: true, paused: true, cancelled: true, blocked: ['1,0'] });
    state.gaps.push({ cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' });
    db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify(state));
    db.close();
    const result = spawnSync(process.execPath, [new URL(cli).pathname, 'status', '--checkpoint', checkpoint], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const actual = JSON.parse(result.stdout);
    assert.deepEqual(actual, {
      version: 1, state: 'potentially_interrupted', headline: 'recovery_pending',
      conditions: ['active_time', 'cancelled', 'cells', 'global_gap', 'paused', 'recovery_pending', 'submissions'],
      geometry: { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 200 } },
      limits: { cells: 1, submissions: 0, activeTime: 0 },
      counters: { admitted: 1, submissions: 0, activeTime: 0 },
      frontier: { queued: ['0,0'], running: [], parked: [], blocked: ['1,0'], discoveryExhausted: false },
      discoveryGaps: [{ id: null, cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' }],
      detailGaps: [], pendingDetails: [],
      coverage: { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false },
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('export retains exact bbox-boundary and outside occurrences without filtering', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-boundary-'));
  const checkpoint = join(directory, 'state.db');
  const fixturePath = join(directory, 'fixture.json');
  const bbox = { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: 0, north: 1, west: 0, east: 1 } };
  try {
    writeFileSync(fixturePath, JSON.stringify({ version: 1, discoveries: { 'work:0,0': { id: 'seed', observationId: 'seed' } }, observations: { seed: { result: { status: 'success', candidates: [
      { id: 'boundary', coordinate: { latitude: 1, longitude: 1 }, verifiedCanonicalKey: 'boundary-key' },
      { id: 'outside', coordinate: { latitude: 1.000001, longitude: 1 }, verifiedCanonicalKey: 'outside-key' },
    ] }, elapsed: 0 } } }));
    await operator.start({ checkpoint, fixture: fixturePath, geometry: bbox, limits: { cells: 1, submissions: 1, activeTime: 100 }, onPreflight() {} });
    const document = operator.exportResults({ checkpoint });
    assert.deepEqual(document.verifiedPlaces, [
      { canonicalKey: 'boundary-key', observations: [{ id: 'boundary', coordinate: { latitude: 1, longitude: 1 }, classification: 'inside', sourceCell: '0,0', workId: 'work:0,0', attemptId: 'work:0,0:attempt:1', observationId: 'work:0,0:attempt:1:observation:1', occurrence: 1 }] },
      { canonicalKey: 'outside-key', observations: [{ id: 'outside', coordinate: { latitude: 1.000001, longitude: 1 }, classification: 'outside', sourceCell: '0,0', workId: 'work:0,0', attemptId: 'work:0,0:attempt:1', observationId: 'work:0,0:attempt:1:observation:2', occurrence: 2 }] },
    ]);
    assert.equal(document.status.geometry.area.type, 'bbox');
    assert.equal(document.status.coverage.returnedPlacesFiltered, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('status reports an exact live-owner interrupted snapshot without recovery mutation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-live-owner-'));
  const checkpoint = join(directory, 'state.db');
  const fixtureIdentity = createHash('sha256').update('synthetic fixture identity').digest('hex');
  try {
    DurableState.createBound(checkpoint, fixtureIdentity, createTraversal(validateGeometry(geometry), { cells: 1, submissions: 2, activeTime: 100 }));
    const db = new DatabaseSync(checkpoint);
    db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(process.pid);
    const state = JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
    state.activeInterval = true;
    db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify(state));
    db.close();
    const result = spawnSync(process.execPath, [new URL(cli).pathname, 'status', '--checkpoint', checkpoint], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      version: 1, state: 'potentially_interrupted', headline: 'recovery_pending', conditions: ['recovery_pending'],
      geometry: { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 200 } },
      limits: { cells: 1, submissions: 2, activeTime: 100 }, counters: { admitted: 1, submissions: 0, activeTime: 0 },
      frontier: { queued: ['0,0'], running: [], parked: [], blocked: [], discoveryExhausted: false },
      discoveryGaps: [], detailGaps: [], pendingDetails: [],
      coverage: { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false },
    });
    const readback = new DatabaseSync(checkpoint, { readOnly: true });
    try {
      assert.equal(readback.prepare('SELECT pid FROM owner WHERE id=1').get().pid, process.pid);
      assert.equal(JSON.parse(readback.prepare('SELECT payload FROM traversal WHERE id=1').get().payload).recoveryPending, false);
    } finally { readback.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('read-only export rejects duplicate observation IDs without detail work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-duplicate-observation-'));
  const checkpoint = join(directory, 'state.db');
  const fixturePath = join(directory, 'fixture.json');
  try {
    writeFileSync(fixturePath, JSON.stringify({ version: 1, discoveries: { 'work:0,0': { id: 'seed', observationId: 'seed' } }, observations: { seed: { result: { status: 'success', candidates: [
      { id: 'first', verifiedCanonicalKey: 'first-key' },
      { id: 'second', verifiedCanonicalKey: 'second-key' },
    ] }, elapsed: 0 } } }));
    await operator.start({ checkpoint, fixture: fixturePath, geometry, limits: { cells: 1, submissions: 1, activeTime: 100 }, onPreflight() {} });
    const db = new DatabaseSync(checkpoint);
    const state = JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
    delete state.detailWork;
    delete state.detailGaps;
    state.candidates[1].observationId = state.candidates[0].observationId;
    db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify(state));
    db.close();
    assert.throws(() => operator.exportResults({ checkpoint }), /Corrupt traversal checkpoint/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('read-only export preserves occurrence provenance and classifies a live-appearing owner', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'inspection-export-'));
  const checkpoint = join(directory, 'state.db');
  const fixturePath = join(directory, 'fixture.json');
  try {
    writeFileSync(fixturePath, JSON.stringify({ version: 1, discoveries: { 'work:0,0': { id: 'seed', observationId: 'seed' } }, observations: { seed: { result: { status: 'success', candidates: [
      { id: 'unverified' },
      { id: 'inside-one', coordinate: { latitude: 0, longitude: 0 }, verifiedCanonicalKey: 'canonical' },
      { id: 'outside', coordinate: { latitude: 5, longitude: 6 }, verifiedCanonicalKey: 'canonical' },
      { id: 'inside-two', coordinate: { latitude: 0.0001, longitude: 0.0001 }, verifiedCanonicalKey: 'canonical' },
      { id: 'other', coordinate: { latitude: 0, longitude: 0 }, verifiedCanonicalKey: 'other-key' },
    ] }, elapsed: 0 } } }));
    await operator.start({ checkpoint, fixture: fixturePath, geometry, limits: { cells: 1, submissions: 1, activeTime: 100 }, onPreflight() {} });
    const db = new DatabaseSync(checkpoint);
    db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(process.pid); db.close();
    const before = new DatabaseSync(checkpoint, { readOnly: true });
    let beforeTraversal; let beforeOwner;
    try {
      beforeTraversal = before.prepare('SELECT payload FROM traversal WHERE id=1').get().payload;
      beforeOwner = before.prepare('SELECT pid FROM owner WHERE id=1').get().pid;
    } finally { before.close(); }
    const document = operator.exportResults({ checkpoint });
    assert.deepEqual(document.verifiedPlaces, [
      { canonicalKey: 'canonical', observations: [
        { id: 'inside-one', coordinate: { latitude: 0, longitude: 0 }, classification: 'inside', sourceCell: '0,0', workId: 'work:0,0', attemptId: 'work:0,0:attempt:1', observationId: 'work:0,0:attempt:1:observation:2', occurrence: 2 },
        { id: 'outside', coordinate: { latitude: 5, longitude: 6 }, classification: 'outside', sourceCell: '0,0', workId: 'work:0,0', attemptId: 'work:0,0:attempt:1', observationId: 'work:0,0:attempt:1:observation:3', occurrence: 3 },
        { id: 'inside-two', coordinate: { latitude: 0.0001, longitude: 0.0001 }, classification: 'inside', sourceCell: '0,0', workId: 'work:0,0', attemptId: 'work:0,0:attempt:1', observationId: 'work:0,0:attempt:1:observation:4', occurrence: 4 },
      ] },
      { canonicalKey: 'other-key', observations: [
        { id: 'other', coordinate: { latitude: 0, longitude: 0 }, classification: 'inside', sourceCell: '0,0', workId: 'work:0,0', attemptId: 'work:0,0:attempt:1', observationId: 'work:0,0:attempt:1:observation:5', occurrence: 5 },
      ] },
    ]);
    assert.deepEqual(document.unverifiedObservations, [{ id: 'unverified', coordinate: null, classification: 'unverified', sourceCell: '0,0', workId: 'work:0,0', attemptId: 'work:0,0:attempt:1', observationId: 'work:0,0:attempt:1:observation:1', occurrence: 1 }]);
    assert.equal(document.status.state, 'potentially_interrupted');
    assert.deepEqual(document.status.conditions, ['cells', 'recovery_pending', 'submissions']);
    const after = new DatabaseSync(checkpoint, { readOnly: true });
    try {
      assert.equal(after.prepare('SELECT pid FROM owner WHERE id=1').get().pid, beforeOwner);
      assert.equal(after.prepare('SELECT payload FROM traversal WHERE id=1').get().payload, beforeTraversal);
      assert.equal(document.status.state, 'potentially_interrupted');
      assert.deepEqual(operator.status({ checkpoint }), document.status);
    } finally { after.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
