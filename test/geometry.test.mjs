import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateGeometry, cellCenter, classifyCandidate, neighbors } from '../dist/index.js';

test('bbox includes edges and validates seed before creating grid', () => {
  const g = validateGeometry({ seed: { latitude: 1, longitude: 2 }, spacing: 100, area: { type: 'bbox', south: 1, north: 2, west: 2, east: 3 } });
  assert.deepEqual(cellCenter(g, 0, 0), { latitude: 1, longitude: 2 });
  assert.equal(classifyCandidate(g, { latitude: 1, longitude: 2 }), 'inside');
  assert.deepEqual(neighbors(g, 0, 0), [[0,1],[0,-1],[1,0],[-1,0]]);
});

test('rejects invalid, pole-contacting and seam-contacting geometry', () => {
  assert.throws(() => validateGeometry({ seed: { latitude: NaN, longitude: 0 }, spacing: 1, area: { type: 'radius', radius: 10 } }));
  assert.throws(() => validateGeometry({ seed: { latitude: 80, longitude: 0 }, spacing: 1, area: { type: 'radius', radius: 11119508.34 } }));
  assert.throws(() => validateGeometry({ seed: { latitude: 10, longitude: 179 }, spacing: 1, area: { type: 'radius', radius: 120000 } }));
});

test('radius membership uses computed inclusive haversine comparison', () => {
  const g = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 1000 } });
  assert.equal(classifyCandidate(g, { latitude: 0, longitude: 1000 / 6371008.8 * 180 / Math.PI }), 'inside');
  assert.equal(classifyCandidate(g, { latitude: 0, longitude: 1 }), 'outside');
  assert.equal(classifyCandidate(g, null), 'unverified');
});
