import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runSyntheticOperator } from '../dist/synthetic-bright-data-operator.js';
import { status, exportResults } from '../dist/operator.js';

const geometry = { seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } };
const limits = { cells: 2, submissions: 2, activeTime: 10000 };
const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
const bounds = () => ({ requestMilliseconds: 1000, activeUntil: Date.now() + 10000, maxObservations: 1, observationDeadline: Date.now() + 10000 });
test('synthetic operator connects bounded expansion and local inspection, rejects mismatched resume', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'synthetic-operator-')); const checkpoint = join(dir, 'state.db');
 try {
  const requests = [];
  const transport = {
   submit: async request => { requests.push(request.body.input[0]); return { status: 202, body: { snapshot_id: `id-${requests.length}` } }; },
   observe: async () => ({ status: 200, body: { status: 'ready' } }),
   retrieve: async id => ({ status: 200, body: id === 'id-1' ? [{ name: 'Synthetic', place_id: 'one' }] : [] }),
  };
  const result = await runSyntheticOperator('start', { checkpoint, geometry, limits, binding, bounds: bounds() }, transport);
  assert.equal(result.command, 'start'); assert.equal(requests.length, 2);
  assert.equal(requests[0].lat, 51); assert.notEqual(requests[1].lat, 51);
  assert.equal(status({ checkpoint }).counters.submissions, 2);
  const durable = new DatabaseSync(checkpoint, { readOnly: true });
  try {
   const persisted = JSON.parse(durable.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
   assert.deepEqual(persisted.candidates.map(candidate => [candidate.id, candidate.name]), [['one', 'Synthetic']]);
  } finally { durable.close(); }
  const v1 = exportResults({ checkpoint });
  assert.equal(v1.unverifiedObservations[0].id, 'one');
  assert.equal('name' in v1.unverifiedObservations[0], false);
  const v2 = exportResults({ checkpoint, format: 'v2' });
  assert.deepEqual(v2.unverifiedObservations.map(item => [item.candidateId, item.name, item.fieldStatus.name, item.detailState]), [['one', 'Synthetic', 'present', 'not_attempted']]);
  const before = exportResults({ checkpoint });
  await assert.rejects(runSyntheticOperator('resume', { checkpoint, geometry, binding: { ...binding, keyword: 'other' }, bounds: bounds() }, transport));
  assert.equal(requests.length, 2); assert.deepEqual(exportResults({ checkpoint }), before);
  await assert.rejects(runSyntheticOperator('resume', { checkpoint, geometry: { ...geometry, spacing: 500 }, binding, bounds: bounds() }, transport), /geometry mismatch/);
  assert.equal(requests.length, 2); assert.deepEqual(exportResults({ checkpoint }), before);
  const resumed = await runSyntheticOperator('resume', { checkpoint, geometry, binding, limits: { submissions: 3 }, bounds: bounds() }, transport);
  assert.equal(resumed.command, 'resume'); assert.equal(resumed.status.limits.submissions, 3); assert.equal(requests.length, 2);
  assert.deepEqual(exportResults({ checkpoint, format: 'v2' }).unverifiedObservations, v2.unverifiedObservations);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('local submission-limit stop resumes queued work without replaying the completed seed', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'synthetic-local-limit-')); const checkpoint = join(dir, 'state.db');
 const requests = [];
 const transport = {
  submit: async request => { requests.push(request.body.input[0]); return { status: 202, body: { snapshot_id: `job-${requests.length}` } }; },
  observe: async () => ({ status: 200, body: { status: 'ready' } }),
  retrieve: async id => ({ status: 200, body: id === 'job-1' ? [{ name: 'Seed place', place_id: 'seed-place', lat: 51, lon: -1 }] : [] }),
 };
 const read = () => {
  const db = new DatabaseSync(checkpoint, { readOnly: true });
  try { return JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); }
  finally { db.close(); }
 };
 try {
  const started = await runSyntheticOperator('start', { checkpoint, geometry, limits: { cells: 5, submissions: 1, activeTime: 10000 }, binding, bounds: bounds() }, transport);
  assert.ok(started.status.conditions.includes('submissions'));
  assert.equal(started.status.counters.submissions, 1);
  assert.equal(requests.length, 1);
  const before = read();
  const beforeExport = exportResults({ checkpoint, format: 'v2' });
  assert.deepEqual(beforeExport.unverifiedObservations.map(item => [item.candidateId, item.name, item.sourceCell]), [['seed-place', 'Seed place', '0,0']]);
  assert.equal(before.cells['0,0'].outcome, 'nonempty');
  assert.deepEqual(before.candidates.map(candidate => [candidate.id, candidate.name, candidate.sourceCell, candidate.occurrence]), [['seed-place', 'Seed place', '0,0', 1]]);

  const resumed = await runSyntheticOperator('resume', { checkpoint, geometry, binding, limits: { submissions: 2 }, bounds: bounds() }, transport);
  assert.equal(resumed.status.limits.submissions, 2);
  assert.equal(resumed.status.counters.submissions, 2);
  assert.equal(requests.length, 2);
  const after = read();
  assert.deepEqual(after.candidates, before.candidates);
  assert.deepEqual(exportResults({ checkpoint, format: 'v2' }).unverifiedObservations, beforeExport.unverifiedObservations);
  assert.equal(after.attempts.filter(attempt => attempt.cellKey === '0,0').length, 1);
  assert.equal(after.attempts.length, 2);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('raised local limits do not reopen a capped partial checkpoint or replay its result', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'synthetic-capped-resume-')); const checkpoint = join(dir, 'state.db');
 const cappedBinding = { ...binding, limitPerInput: 2 };
 let submissions = 0, observations = 0, retrievals = 0;
 const transport = {
  submit: async () => { submissions++; return { status: 202, body: { snapshot_id: 'capped-job' } }; },
  observe: async () => { observations++; return { status: 200, body: { status: 'ready' } }; },
  retrieve: async () => { retrievals++; return { status: 200, body: [
   { name: 'First', place_id: 'p1', lat: 51, lon: -1 },
   { name: 'Second', place_id: 'p2' },
  ] }; },
 };
 const read = () => {
  const db = new DatabaseSync(checkpoint, { readOnly: true });
  try { return JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); }
  finally { db.close(); }
 };
 try {
  await runSyntheticOperator('start', { checkpoint, geometry, limits: { cells: 1, submissions: 1, activeTime: 10000 }, binding: cappedBinding, bounds: bounds() }, transport);
  const before = read();
  assert.equal(before.cells['0,0'].outcome, 'partial');
  assert.deepEqual(before.queue, []);
  assert.ok(before.gaps.some(gap => gap.cause === 'partial' && gap.cellKey === '0,0' && gap.status === 'unresolved'));
  assert.deepEqual(before.candidates.map(candidate => [candidate.id, candidate.name, candidate.coordinate, candidate.sourceCell, candidate.attemptId, candidate.observationId, candidate.occurrence]), [
   ['p1', 'First', { latitude: 51, longitude: -1 }, '0,0', before.attempts[0].id, `${before.attempts[0].id}:observation:1`, 1],
   ['p2', 'Second', undefined, '0,0', before.attempts[0].id, `${before.attempts[0].id}:observation:2`, 2],
  ]);
  const callsBeforeResume = [submissions, observations, retrievals];
  await runSyntheticOperator('resume', { checkpoint, geometry, binding: cappedBinding, limits: { cells: 2, submissions: 2 }, bounds: bounds() }, transport);
  const after = read();
  assert.deepEqual(after.candidates, before.candidates);
  assert.deepEqual(after.gaps, before.gaps);
  assert.equal(after.cells['0,0'].outcome, 'partial');
  assert.deepEqual(after.queue, []);
  assert.deepEqual([submissions, observations, retrievals], callsBeforeResume);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('inline discovery persists names for public v2 inspection without detail or replay', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'synthetic-inline-')); const checkpoint = join(dir, 'state.db');
 let submits = 0, otherCalls = 0;
 const unexpected = async () => { otherCalls++; throw new Error('unexpected observation or retrieval'); };
 const transport = { submit: async () => { submits++; return { status: 200, body: [{ name: 'Inline place', place_id: 'inline-id' }] }; }, observe: unexpected, retrieve: unexpected };
 try {
  await runSyntheticOperator('start', { checkpoint, geometry, limits: { cells: 1, submissions: 1, activeTime: 10000 }, binding, bounds: bounds() }, transport);
  const before = exportResults({ checkpoint, format: 'v2' });
  assert.deepEqual(before.unverifiedObservations.map(item => [item.candidateId, item.name, item.fieldStatus.name, item.sourceCell, item.detailState]), [['inline-id', 'Inline place', 'present', '0,0', 'not_attempted']]);
  assert.deepEqual(before.status, status({ checkpoint }));
  await runSyntheticOperator('resume', { checkpoint, geometry, binding, limits: { submissions: 2 }, bounds: bounds() }, transport);
  assert.deepEqual(exportResults({ checkpoint, format: 'v2' }).unverifiedObservations, before.unverifiedObservations);
  assert.equal(submits, 1); assert.equal(otherCalls, 0);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
