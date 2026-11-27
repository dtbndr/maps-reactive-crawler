import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { runSyntheticBrightData } from '../dist/durable-bright-data-submission.js';

const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
const bounds = () => ({ requestMilliseconds: 1000, activeUntil: Date.now() + 10000, maxObservations: 1, observationDeadline: Date.now() + 10000 });
for (const delay of ['60', '0']) test(`durable retry-after ${delay} resumes safely`, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'retry-after-')); const path = join(dir, 'state.db'); let state;
 try {
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 1, submissions: 1, activeTime: 10000 }));
  let sends = 0, observations = 0, now = 1000000;
  const clock = { monotonicNow: () => 0, wallNow: () => now };
  const transport = { submit: async () => { sends++; return { status: 202, body: { snapshot_id: 'known' }, retryAfter: delay }; }, observe: async id => { assert.equal(id, 'known'); observations++; return { status: 200, body: { status: 'ready' } }; }, retrieve: async () => ({ status: 200, body: [] }) };
  state = DurableState.openBound(path, binding);
  await runSyntheticBrightData(state, transport, bounds(), clock);
  if (delay === '60') {
   assert.equal(observations, 0); assert.equal(state.readTraversal().attempts[0].knownId, 'known');
   state.close(); state = DurableState.openBound(path, binding);
   now += 30000; assert.equal((await runSyntheticBrightData(state, transport, bounds(), clock)).reason, 'retry-after-pending');
   assert.equal(observations, 0);
   now -= 1; assert.equal((await runSyntheticBrightData(state, transport, bounds(), clock)).reason, 'retry-after-pending');
   now = NaN; assert.equal((await runSyntheticBrightData(state, transport, bounds(), clock)).reason, 'retry-after-pending');
   assert.equal(observations, 0); now = 1030000;
   now += 30000; await runSyntheticBrightData(state, transport, bounds(), clock);
  }
  assert.equal(observations, 1); assert.equal(sends, 1);
 } finally { state?.close(); rmSync(dir, { recursive: true, force: true }); }
});

for (const [label, delay, initial] of [['overflow', '9007199254740991', 1000000], ['invalid-clock', '60', NaN]]) test(`retry-after ${label} preserves ID and fails closed`, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'retry-invalid-')); const path = join(dir, 'state.db'); let state;
 try {
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 1, submissions: 1, activeTime: 10000 }));
  let sends = 0, observations = 0, now = initial;
  const clock = { monotonicNow: () => 0, wallNow: () => now };
  const transport = { submit: async () => { sends++; return { status: 202, body: { snapshot_id: 'known' }, retryAfter: delay }; }, observe: async () => { observations++; return { status: 200, body: { status: 'ready' } }; }, retrieve: async () => ({ status: 200, body: [] }) };
  state = DurableState.openBound(path, binding);
  assert.equal((await runSyntheticBrightData(state, transport, bounds(), clock)).reason, 'retry-after-pending');
  state.close(); state = DurableState.openBound(path, binding); now = 2000000;
  assert.equal((await runSyntheticBrightData(state, transport, bounds(), clock)).reason, 'retry-after-pending');
  assert.equal(state.readTraversal().attempts[0].knownId, 'known'); assert.equal(sends, 1); assert.equal(observations, 0);
 } finally { state?.close(); rmSync(dir, { recursive: true, force: true }); }
});
