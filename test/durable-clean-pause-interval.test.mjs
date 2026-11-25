import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { validateGeometry } from '../dist/index.js';
import { recordDurableCleanPause } from '../dist/durable-discovery.js';
const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 10, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
test('clean pause evidence and active intervals cannot coexist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clean-pause-'));
  const state = DurableState.open(join(dir, 'state.db'));
  try {
    state.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    recordDurableCleanPause(state, 'operator pause');
    const paused = state.readTraversal();
    assert.throws(() => state.beginActiveInterval(), /interval/i);
    assert.deepEqual(state.readTraversal(), paused);
    state.transitionTraversal(value => ({ ...value, cleanPauseEvidence: undefined, paused: false }));
    state.beginActiveInterval();
    const active = state.readTraversal();
    assert.throws(() => recordDurableCleanPause(state, 'operator pause'), /active interval/i);
    assert.deepEqual(state.readTraversal(), active);
    state.close();
    const raw = DurableState.open(join(dir, 'state.db'));
    try {
      assert.throws(() => raw.transitionTraversal(value => ({ ...value, paused: true, cleanPauseEvidence: { evidence: 'bad' } })), /Corrupt traversal checkpoint/);
      assert.deepEqual(raw.readTraversal(), { ...active, activeInterval: false, recoveryPending: true });
    } finally { raw.close(); }
  } finally { try { state.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
});
