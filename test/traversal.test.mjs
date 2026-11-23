import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, applyDiscoveryResult } from '../dist/index.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });

test('raw nonempty results retain candidates and admit deterministic unique FIFO neighbors', () => {
  let state = createTraversal(geometry);
  assert.deepEqual(state.queue, ['0,0']);
  state = admitNextCell(state);
  state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'outside', coordinate: { latitude: 2, longitude: 2 } }] });
  assert.deepEqual(state.queue, ['0,1', '0,-1', '1,0', '-1,0']);
  assert.deepEqual(state.candidates.map(c => c.classification), ['outside']);
  state = admitNextCell(state); // north
  state = applyDiscoveryResult(state, '0,1', { status: 'success', candidates: [{ id: 'outside', coordinate: { latitude: 2, longitude: 2 } }] });
  assert.equal(state.queue.filter(k => k === '0,0').length, 0);
  assert.deepEqual(state.queue, ['0,-1', '1,0', '-1,0', '0,2', '1,1', '-1,1']);
});

test('isolated failure leaves independent queued work available while global failure pauses admissions', () => {
  const withNeighbors = () => {
    let state = admitNextCell(createTraversal(geometry));
    state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'x' }] });
    return state;
  };
  let isolated = withNeighbors();
  isolated = admitNextCell(isolated);
  isolated = applyDiscoveryResult(isolated, '0,1', { status: 'failed', scope: 'isolated' });
  assert.equal(isolated.paused, false);
  assert.equal(admitNextCell(isolated).cells['0,-1'].outcome, 'running');

  let global = withNeighbors();
  global = admitNextCell(global);
  global = applyDiscoveryResult(global, '0,1', { status: 'failed', scope: 'global' });
  assert.equal(global.paused, true);
  assert.throws(() => admitNextCell(global), /paused/);
});

test('admission is serial and rejects a second running cell', () => {
  let state = admitNextCell(createTraversal(geometry));
  state = applyDiscoveryResult(state, '0,0', { status: 'success', candidates: [{ id: 'x' }] });
  state = admitNextCell(state);
  assert.throws(() => admitNextCell(state), /running/);
});

test('empty, failed and unrecognized outcomes do not expand and failures remain gaps', () => {
  const apply = result => applyDiscoveryResult(admitNextCell(createTraversal(geometry)), '0,0', result);
  const empty = apply({ status: 'empty' });
  const failed = apply({ status: 'failed', cause: 'isolated', scope: 'isolated' });
  const unrecognized = apply({ status: 'unrecognized' });
  assert.equal(empty.cells['0,0'].outcome, 'empty');
  assert.equal(failed.cells['0,0'].outcome, 'failed');
  assert.equal(unrecognized.cells['0,0'].outcome, 'unrecognized');
  assert.deepEqual(empty.queue, []);
  assert.deepEqual(failed.queue, []);
  assert.deepEqual(unrecognized.queue, []);
  assert.deepEqual(failed.gaps.map(g => g.cellKey), ['0,0']);
  assert.deepEqual(unrecognized.gaps.map(g => g.cellKey), ['0,0']);
});
