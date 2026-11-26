import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as operator from '../dist/index.js';
const { validateOperatorConfig, parseSyntheticFixture } = operator;

const configuration = {
  geometry: { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 1000 } },
  limits: { cells: 10, submissions: 20, activeTime: 30 },
};
const fixtureBytes = Buffer.from(JSON.stringify({ version: 1, discoveries: { 'work:0,0': { id: 'job-1', observationId: 'job-1' } }, observations: { 'job-1': { result: { status: 'empty' }, elapsed: 2 } } }));

test('validates one-seed operator geometry and independent finite limits', () => {
  assert.equal(typeof validateOperatorConfig, 'function');
  assert.deepEqual(validateOperatorConfig(configuration), configuration);
  for (const invalid of [
    { ...configuration, geometry: { ...configuration.geometry, seed: null } },
    { ...configuration, geometry: { ...configuration.geometry, spacing: 0 } },
    { ...configuration, geometry: { ...configuration.geometry, area: undefined } },
    { ...configuration, limits: { ...configuration.limits, cells: Infinity } },
    { ...configuration, limits: { ...configuration.limits, submissions: -1 } },
    { ...configuration, limits: { ...configuration.limits, activeTime: NaN } },
    { ...configuration, geometry: { ...configuration.geometry, area: { ...configuration.geometry.area, unexpected: true } } },
  ]) assert.throws(() => validateOperatorConfig(invalid));
});

test('parses strict v1 synthetic discoveries with exact-byte SHA-256 identity', () => {
  assert.equal(typeof parseSyntheticFixture, 'function');
  const parsed = parseSyntheticFixture(fixtureBytes);
  assert.equal(parsed.identity, createHash('sha256').update(fixtureBytes).digest('hex'));
  assert.equal(parsed.discoveries['work:0,0'].id, 'job-1');
  assert.equal(parsed.observations['job-1'].elapsed, 2);
  assert.equal(parseSyntheticFixture(Buffer.from(fixtureBytes)).identity, parsed.identity);
  assert.notEqual(parseSyntheticFixture(Buffer.from(`${fixtureBytes} `)).identity, parsed.identity);
});

test('rejects malformed, non-v1, duplicate-key, and unknown-field fixture data', () => {
  for (const bytes of [
    Buffer.from('{'),
    Buffer.from('{"version":2,"discoveries":{},"observations":{}}'),
    Buffer.from('{"version":1,"version":1,"discoveries":{},"observations":{}}'),
    Buffer.from('{"version":1,"discoveries":{},"observations":{},"extra":true}'),
  ]) assert.throws(() => parseSyntheticFixture(bytes));
});

test('rejects invalid references, duplicate IDs per work, whitespace IDs and invalid observations', () => {
  const invalidFixtures = [
    { version: 1, discoveries: { w: { id: 'missing', observationId: 'missing' } }, observations: {} },
    { version: 1, discoveries: { w: { id: '  ', observationId: 'x' } }, observations: { x: { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { w: { id: 'x', observationId: '  ' } }, observations: { '  ': { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { a: { id: 'same', observationId: 'x' }, b: { id: 'same', observationId: 'y' } }, observations: { x: { result: { status: 'empty' }, elapsed: 0 }, y: { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { w: { id: 'x', observationId: 'x' } }, observations: { x: { result: { status: 'empty' }, elapsed: -1 } } },
  ];
  for (const fixture of invalidFixtures) assert.throws(() => parseSyntheticFixture(Buffer.from(JSON.stringify(fixture))));
});
