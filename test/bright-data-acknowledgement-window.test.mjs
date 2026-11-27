import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVIDER_REQUEST_MILLISECONDS } from '../dist/cli.js';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { submitDurableBrightData } from '../dist/durable-bright-data-submission.js';
import { createBrightDataHttpCandidate } from '../dist/bright-data-http-candidate.js';

test('CLI uses the same acknowledgement window at both timeout layers', () => {
 const source = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');
 assert.match(source, /createBrightDataHttpCandidate\(key, PROVIDER_REQUEST_MILLISECONDS\)/);
 assert.match(source, /requestMilliseconds: PROVIDER_REQUEST_MILLISECONDS/);
 assert.ok(PROVIDER_REQUEST_MILLISECONDS > 60000);
});

for (const active of [90000, 20000]) test(`delayed acknowledgement with ${active}ms active budget`, async t => {
 t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
 const dir = mkdtempSync(join(tmpdir(), 'ack-window-')); let state;
 try {
  const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
  const path = join(dir, 'state.db');
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 1, submissions: 1, activeTime: active }));
  state = DurableState.openBound(path, binding);
  let sends = 0, signal;
  const transport = createBrightDataHttpCandidate('synthetic', PROVIDER_REQUEST_MILLISECONDS, async (_url, init) => {
   sends++; signal = init.signal;
   return await new Promise(resolve => setTimeout(() => resolve(new Response(JSON.stringify({ snapshot_id: 'synthetic-id' }), { status: 202 })), 61000));
  });
  const task = submitDurableBrightData(state, transport, { requestMilliseconds: PROVIDER_REQUEST_MILLISECONDS, activeUntil: Date.now() + active });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(sends, 1);
  t.mock.timers.tick(active === 90000 ? 61000 : 20000);
  await task;
  const result = state.readTraversal();
  assert.equal(sends, 1);
  if (active === 90000) {
   assert.equal(signal.aborted, false);
   assert.equal(result.attempts[0].knownId, 'synthetic-id');
   assert.equal(result.attempts[0].status, 'observing');
  } else {
   assert.equal(signal.aborted, true); // Local abort only; remote work may continue.
   assert.equal(result.attempts[0].knownId, undefined);
   assert.equal(result.attempts[0].status, 'uncertain');
   assert.ok(result.gaps.some(g => g.cause === 'uncertain'));
   t.mock.timers.tick(41000);
   await Promise.resolve();
   assert.deepEqual(state.readTraversal(), result);
   assert.equal(sends, 1);
  }
 } finally { state?.close(); rmSync(dir, { recursive: true, force: true }); }
});
