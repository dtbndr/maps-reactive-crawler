import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateGeometry, createTraversal } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { DurableStopError, executeDurableDiscovery } from '../dist/durable-discovery.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
function open(limits = { cells: 1, submissions: 1, activeTime: 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'operator-stop-'));
  const state = DurableState.open(join(dir, 'state.db'));
  state.writeTraversal(createTraversal(geometry, limits));
  return { dir, state };
}
test('active-time boundary emits the exported stop class even with unresolved gap', () => {
  const { dir, state } = open();
  try {
    const current = state.readTraversal();
    state.writeTraversal({ ...current, gaps: [{ cellKey: '0,0', cause: 'failed', scope: 'isolated', status: 'unresolved' }] });
    assert.throws(() => executeDurableDiscovery(state, () => ({ id: 'id' }), () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => 0 }), error => error instanceof DurableStopError && error.reason === 'active-time-limit');
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('callback errors remain ordinary errors when final settlement reaches the cap', () => {
  const { dir, state } = open({ cells: 1, submissions: 1, activeTime: 5 });
  try {
    const failure = new Error('send callback failed');
    let now = 0;
    assert.throws(() => executeDurableDiscovery(state, () => { now = 5; throw failure; }, () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => now }), error => error === failure && !(error instanceof DurableStopError));
    const result = state.readTraversal();
    assert.equal(result.activeTime, 5);
    assert.equal(result.activeInterval, false);
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('ordinary transition errors remain ordinary when cleanup settlement reaches the cap', () => {
  const { dir, state } = open({ cells: 1, submissions: 1, activeTime: 5 });
  try {
    const failure = new Error('reservation transition failed');
    let now = 0;
    const transition = state.transitionTraversal.bind(state);
    state.transitionTraversal = change => transition(value => {
      const updated = change(value);
      if (updated.attempts.some(attempt => attempt.status === 'reserved')) {
        now = 5;
        throw failure;
      }
      return updated;
    });
    assert.throws(() => executeDurableDiscovery(state, () => ({ id: 'id' }), () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => now }), error => error === failure && !(error instanceof DurableStopError));
    const result = state.readTraversal();
    assert.equal(result.activeTime, 5);
    assert.equal(result.activeInterval, false);
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('failed cleanup settlement supersedes pending typed stop and retains interval marker', () => {
  const { dir, state } = open({ cells: 1, submissions: 1, activeTime: 5 });
  try {
    const samples = [0, 5, 4];
    assert.throws(() => executeDurableDiscovery(state, () => ({ id: 'id' }), () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => samples.shift() }), error => !(error instanceof DurableStopError) && /Invalid monotonic clock sample/.test(error.message));
    const result = state.readTraversal();
    assert.equal(result.activeTime, 5);
    assert.equal(result.activeInterval, true);
    assert.deepEqual(samples, []);
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('recovery accounting boundary emits the exported stop class', () => {
  const { dir, state } = open();
  try {
    state.writeTraversal({ ...state.readTraversal(), recoveryPending: true });
    assert.throws(() => executeDurableDiscovery(state, () => ({ id: 'id' }), () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => 0 }), error => error instanceof DurableStopError && error.reason === 'recovery-pending');
  } finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
});
