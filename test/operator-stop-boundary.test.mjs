import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateGeometry, createTraversal } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { executeDurableDiscovery } from '../dist/durable-discovery.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
function open(limits = { cells: 1, submissions: 1, activeTime: 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'operator-stop-'));
  const state = DurableState.open(join(dir, 'state.db'));
  state.writeTraversal(createTraversal(geometry, limits));
  return { dir, state };
}
function isStop(error) { return error?.name === 'DurableStopError'; }

test('active-time boundary emits a typed stop even when unresolved gap is also present', () => {
  const { dir, state } = open();
  try {
    const current = state.readTraversal();
    state.writeTraversal({ ...current, gaps: [{ cellKey: '0,0', cause: 'failed', scope: 'isolated', status: 'unresolved' }] });
    assert.throws(() => executeDurableDiscovery(state, () => ({ id: 'id' }), () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => 0 }), error => isStop(error) && error.reason === 'active-time-limit');
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('recovery accounting boundary emits a typed stop', () => {
  const { dir, state } = open();
  try {
    state.writeTraversal({ ...state.readTraversal(), recoveryPending: true });
    assert.throws(() => executeDurableDiscovery(state, () => ({ id: 'id' }), () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => 0 }), error => isStop(error) && error.reason === 'recovery-pending');
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});
