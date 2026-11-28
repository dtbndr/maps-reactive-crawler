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
  const before = exportResults({ checkpoint });
  await assert.rejects(runSyntheticOperator('resume', { checkpoint, geometry, binding: { ...binding, keyword: 'other' }, bounds: bounds() }, transport));
  assert.equal(requests.length, 2); assert.deepEqual(exportResults({ checkpoint }), before);
  await assert.rejects(runSyntheticOperator('resume', { checkpoint, geometry: { ...geometry, spacing: 500 }, binding, bounds: bounds() }, transport), /geometry mismatch/);
  assert.equal(requests.length, 2); assert.deepEqual(exportResults({ checkpoint }), before);
  const resumed = await runSyntheticOperator('resume', { checkpoint, geometry, binding, limits: { submissions: 3 }, bounds: bounds() }, transport);
  assert.equal(resumed.command, 'resume'); assert.equal(resumed.status.limits.submissions, 3); assert.equal(requests.length, 2);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
