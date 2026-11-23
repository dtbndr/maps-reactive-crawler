import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateGeometry, cellCenter, classifyCandidate, neighbors, isCellEligible, haversineDistance } from '../dist/index.js';

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

test('rejects bbox contact at either longitude seam', () => {
  for (const bounds of [
    { south: -1, north: 1, west: -180, east: 0 },
    { south: -1, north: 1, west: 0, east: 180 },
  ]) assert.throws(() => validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 1, area: { type: 'bbox', ...bounds } }));
});

test('screens out-of-range projected cardinal centers as ineligible', () => {
  const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 20_000_000, area: { type: 'bbox', south: -0.0001, north: 0.0001, west: -0.0001, east: 0.0001 } });
  assert.equal(isCellEligible(geometry, 0, 0), true);
  assert.equal(isCellEligible(geometry, 0, 1), false);
  assert.deepEqual(neighbors(geometry, 0, 0).filter(([c,r]) => isCellEligible(geometry,c,r)), []);
});

test('acceptance geometry covers outside seed, tiny area and high latitude', () => {
  assert.throws(() => validateGeometry({ seed: { latitude: 2, longitude: 0 }, spacing: 1, area: { type: 'bbox', south: 0, north: 1, west: -1, east: 1 } }));
  const tiny = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 1000, area: { type: 'bbox', south: -0.0001, north: 0.0001, west: -0.0001, east: 0.0001 } });
  assert.equal(isCellEligible(tiny, 0, 0), true);
  assert.equal(neighbors(tiny, 0, 0).some(([c,r]) => isCellEligible(tiny,c,r)), false);
  const polar = validateGeometry({ seed: { latitude: 80, longitude: 0 }, spacing: 1000, area: { type: 'radius', radius: 2000 } });
  const east = cellCenter(polar, 1, 0);
  assert.ok(east.longitude > 0.05);
  assert.equal(classifyCandidate(polar, { latitude: 80 + 1000 / 6371008.8 * 180 / Math.PI, longitude: 0 }), 'inside');
});

test('radius membership includes computed equality and excludes computed distance above radius', () => {
  const point = { latitude: 0, longitude: 1000 / 6371008.8 * 180 / Math.PI };
  const exactDistance = haversineDistance({ latitude: 0, longitude: 0 }, point);
  const equal = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 10, area: { type: 'radius', radius: exactDistance } });
  assert.equal(classifyCandidate(equal, point), 'inside');
  const above = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 10, area: { type: 'radius', radius: exactDistance - 1e-9 } });
  assert.equal(classifyCandidate(above, point), 'outside');
});

test('radius membership uses computed inclusive haversine comparison', () => {
  const g = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 1000 } });
  assert.equal(classifyCandidate(g, { latitude: 0, longitude: 1000 / 6371008.8 * 180 / Math.PI }), 'inside');
  assert.equal(classifyCandidate(g, { latitude: 0, longitude: 1 }), 'outside');
  assert.equal(classifyCandidate(g, null), 'unverified');
});
