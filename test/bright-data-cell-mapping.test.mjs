import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import * as mapping from '../dist/bright-data-mapping.js';
import { cellCenter } from '../dist/index.js';
import { createTraversal, admitNextCell, reserveSubmission, dispatchSubmission, applyDiscoveryResult } from '../dist/traversal.js';

const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
test('maps persisted admitted seed and neighbor attempts to their own centers; rejects unadmitted cells', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cell-mapping-'));
  const path = join(dir, 'state.db');
  const geometry = { seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } };
  try {
    DurableState.createBound(path, binding, createTraversal(geometry, { cells: 5, submissions: 5, activeTime: 10000 }));
    const db = DurableState.openBound(path, binding);
    try {
      db.transitionTraversal(s => dispatchSubmission(reserveSubmission(admitNextCell(s), '0,0'), '0,0'));
      let state = db.readTraversal();
      const seed = mapping.mapAdmittedDiscoveryRequest(state, state.attempts.at(-1), binding);
      assert.equal(seed.body.input[0].lat, 51);
      assert.equal(seed.body.input[0].long, -1);
      assert.equal(seed.body.input[0].keyword, 'pizza');
      db.transitionTraversal(s => applyDiscoveryResult(s, '0,0', { status: 'success', candidates: [{ id: 'x' }] }));
      db.transitionTraversal(s => dispatchSubmission(reserveSubmission(admitNextCell(s), '0,1'), '0,1'));
      state = db.readTraversal();
      const attempt = state.attempts.at(-1);
      const neighbor = mapping.mapAdmittedDiscoveryRequest(state, attempt, binding);
      const center = cellCenter(state.geometry, 0, 1);
      assert.equal(neighbor.body.input[0].lat, center.latitude);
      assert.equal(neighbor.body.input[0].long, center.longitude);
      assert.notEqual(neighbor.body.input[0].lat, seed.body.input[0].lat);
      const forged = { ...attempt, cellKey: '9,9' };
      const unadmitted = { ...state, attempts: [...state.attempts.slice(0, -1), forged], cells: { ...state.cells, '9,9': { outcome: 'running' } } };
      assert.throws(() => mapping.mapAdmittedDiscoveryRequest(unadmitted, forged, binding), /admitted|eligible/i);
      const ineligible = { ...unadmitted, admitted: [...state.admitted, '9,9'] };
      assert.throws(() => mapping.mapAdmittedDiscoveryRequest(ineligible, forged, binding), /admitted|eligible/i);
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
