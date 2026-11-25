import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { validateGeometry } from '../dist/index.js';
const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 10, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
function open() { const dir = mkdtempSync(join(tmpdir(), 'active-interval-')); const state = DurableState.open(join(dir, 'state.db')); state.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 })); return { dir, state }; }
test('active interval settles once and end clears marker; invalid elapsed is rejected', () => {
  const { dir, state } = open();
  try {
    assert.equal(state.readTraversal().activeInterval, undefined);
    state.beginActiveInterval();
    assert.equal(state.readTraversal().activeInterval, true);
    assert.throws(() => state.beginActiveInterval(), /interval/i);
    for (const elapsed of [-1, NaN, Infinity]) assert.throws(() => state.settleActiveInterval(elapsed), /elapsed/i);
    state.settleActiveInterval(3.5);
    assert.equal(state.readTraversal().activeTime, 3.5);
    assert.equal(state.readTraversal().activeInterval, true);
    state.endActiveInterval();
    assert.equal(state.readTraversal().activeInterval, false);
    assert.equal(state.readTraversal().activeTime, 3.5);
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});
