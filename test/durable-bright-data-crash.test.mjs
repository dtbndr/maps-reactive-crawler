import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { resolveDurableRecoveryDebit } from '../dist/durable-discovery.js';
import { runSyntheticBrightData } from '../dist/durable-bright-data-submission.js';

const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
const geometry = { seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } };
const limits = { cells: 1, submissions: 1, activeTime: 10000 };
const bounds = () => ({ requestMilliseconds: 1000, activeUntil: Date.now() + 10000, maxObservations: 1, observationDeadline: Date.now() + 10000 });

test('interrupted dispatched unknown ID remains a visible gap without another transport call', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'provider-crash-'));
 const path = join(dir, 'crash.db'); const controlPath = join(dir, 'control.db');
 let state, control;
 try {
  DurableState.createBound(path, binding, createTraversal(geometry, limits));
  const stateUrl = new URL('../dist/durable-state.js', import.meta.url).href;
  const runnerUrl = new URL('../dist/durable-bright-data-submission.js', import.meta.url).href;
  const child = `import { DurableState } from ${JSON.stringify(stateUrl)}; import { runSyntheticBrightData } from ${JSON.stringify(runnerUrl)}; const state = DurableState.openBound(${JSON.stringify(path)}, ${JSON.stringify(binding)}); await runSyntheticBrightData(state, { submit: async () => process.exit(41), observe: async () => { throw Error('unexpected observe'); }, retrieve: async () => { throw Error('unexpected retrieve'); } }, { requestMilliseconds: 1000, activeUntil: Date.now()+10000, maxObservations: 1, observationDeadline: Date.now()+10000 }); process.exit(42);`;
  const died = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8', timeout: 10000 });
  assert.equal(died.status, 41, died.stderr);
  const db = new DatabaseSync(path, { readOnly: true });
  let raw; try { raw = JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); } finally { db.close(); }
  assert.equal(raw.activeInterval, true); assert.equal(raw.attempts[0].status, 'dispatched'); assert.equal(raw.attempts[0].knownId, undefined); assert.equal(raw.submissions, 1);
  state = DurableState.openBound(path, binding);
  assert.equal(state.readTraversal().recoveryPending, true);
  let sends = 0, observes = 0, retrieves = 0;
  const transport = { submit: async () => { sends++; return { status: 202, body: { snapshot_id: 'control-id' } }; }, observe: async () => { observes++; return { status: 200, body: { status: 'ready' } }; }, retrieve: async () => { retrieves++; return { status: 200, body: [] }; } };
  assert.equal((await runSyntheticBrightData(state, transport, bounds())).reason, 'unavailable');
  resolveDurableRecoveryDebit(state, 1, 'synthetic interrupted interval');
  const result = await runSyntheticBrightData(state, transport, bounds());
  const recovered = state.readTraversal();
  assert.equal(result.reason, 'gap');
  assert.equal(sends, 0); assert.equal(observes, 0); assert.equal(retrieves, 0);
  assert.equal(recovered.attempts[0].status, 'uncertain'); assert.equal(recovered.attempts[0].knownId, undefined);
  assert.ok(recovered.gaps.some(g => g.cellKey === '0,0' && g.cause === 'uncertain' && g.status === 'unresolved'));
  assert.equal(recovered.cells['0,0'].outcome, 'parked'); assert.equal(recovered.candidates.length, 0); assert.equal(recovered.submissions, 1);
  DurableState.createBound(controlPath, binding, createTraversal(geometry, limits));
  control = DurableState.openBound(controlPath, binding);
  await runSyntheticBrightData(control, transport, bounds());
  assert.equal(sends, 1); assert.equal(observes, 1); assert.equal(retrieves, 1);
  assert.equal(control.readTraversal().cells['0,0'].outcome, 'empty');
 } finally { state?.close(); control?.close(); rmSync(dir, { recursive: true, force: true }); }
});
