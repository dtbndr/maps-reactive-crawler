import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, authorizeResend, markUncertain } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'durable-discovery-')); return { dir, path: join(dir, 'state.db') }; };

test('submission attempts have stable replay identities across uncertainty and resend', () => {
  let state = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
  const key = state.queue[0];
  state = admitNextCell(state);
  state = reserveSubmission(state, key);
  const first = state.attempts[0];
  assert.equal(typeof first.id, 'string');
  assert.equal(first.workId, `work:${key}`);
  state = { ...state, attempts: [{ ...first, status: 'dispatched' }] };
  state = markUncertain(state, key);
  state = authorizeResend(state, key);
  assert.equal(state.attempts[1].workId, first.workId);
  assert.notEqual(state.attempts[1].id, first.id);
});

test('durable traversal transitions persist queue, observations, attempts and counters atomically', () => {
  const { dir, path } = temp();
  try {
    const state = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
    state.writeTraversal(initial);
    state.transitionTraversal(current => reserveSubmission(admitNextCell(current), '0,0'));
    assert.equal(state.readTraversal().submissions, 1);
    state.close();
    const reopened = DurableState.open(path);
    assert.deepEqual(reopened.readTraversal(), stateSnapshot(initial));
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
function stateSnapshot(initial) { return reserveSubmission(admitNextCell(initial), '0,0'); }
