import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { submitDurableBrightData, observeDurableBrightData } from '../dist/durable-bright-data-submission.js';
const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
for (const scenario of ['unknown', 'error', 'observation timeout', 'retrieval timeout', 'partial']) test(`${scenario} retains ID and gap without resending or expansion`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'observation-gap-')), path = join(dir, 'state.db');
  DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 5, submissions: 5, activeTime: 10000 }));
  const state = DurableState.openBound(path, binding); let sends = 0, retrieves = 0, release;
  try {
    await submitDurableBrightData(state, { submit: async () => { sends++; return { status: 202, body: { snapshot_id: 'id' } }; } }, { requestMilliseconds: 1000, activeUntil: Date.now() + 5000 });
    await observeDurableBrightData(state, { observe: async () => {
      if (scenario === 'error') throw Error('synthetic');
      if (scenario === 'observation timeout') return new Promise(resolve => { release = resolve; });
      return { status: 200, body: { status: scenario === 'unknown' ? 'unknown' : 'ready' } };
    }, retrieve: async () => { retrieves++; if (scenario === 'retrieval timeout') return new Promise(resolve => { release = resolve; }); return { status: 200, body: [{ name: 'valid', place_id: 'p' }, {}] }; } }, { requestMilliseconds: 20, activeUntil: Date.now() + 1000, observationDeadline: Date.now() + 1000, maxObservations: 2 });
    const s = state.readTraversal(); assert.equal(s.attempts.at(-1).knownId, 'id'); assert.equal(s.attempts.at(-1).status, scenario === 'partial' ? 'observed' : 'uncertain'); assert.equal(s.cells['0,0'].outcome, scenario === 'partial' ? 'partial' : 'parked'); assert.ok(s.gaps.some(g => g.status === 'unresolved')); assert.equal(s.queue.length, 0); assert.equal(sends, 1); assert.equal(retrieves, ['retrieval timeout', 'partial'].includes(scenario) ? 1 : 0); assert.equal(s.activeInterval, false);
    if (release) { release({ status: 200, body: scenario === 'observation timeout' ? { status: 'ready' } : [{ name: 'late', place_id: 'p' }] }); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(state.readTraversal().cells['0,0'].outcome, 'parked'); }
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});
