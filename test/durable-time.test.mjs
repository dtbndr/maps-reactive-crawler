import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraversal, admitNextCell, dispatchSubmission } from '../dist/traversal.js';
const geometry = { origin: { latitude: 0, longitude: 0 }, radiusMeters: 1000, cellSizeMeters: 500 };
test('unresolved crash accounting blocks admission and dispatch', () => {
  let state = createTraversal(geometry, { cells: 3, submissions: 3, activeTime: 100 });
  state = { ...state, queue: ['0,0'], recoveryPending: true };
  assert.throws(() => admitNextCell(state), /recovery/i);
  state = { ...state, cells: { '0,0': { outcome: 'running' } } };
  state = { ...state, attempts: [{ id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'reserved' }], submissions: 1 };
  assert.throws(() => dispatchSubmission(state, '0,0'), /recovery/i);
});
