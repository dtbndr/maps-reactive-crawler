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

test('[preservation] parses strict v1 synthetic discoveries with exact-byte SHA-256 identity', () => {
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

test('rejects prototype-key fixture fields and discovery keys', () => {
  for (const bytes of [
    Buffer.from('{"version":1,"discoveries":{},"observations":{},"__proto__":true}'),
    Buffer.from('{"version":1,"discoveries":{"w":{"id":"x","observationId":"x","__proto__":true}},"observations":{"x":{"result":{"status":"empty"},"elapsed":0}}}'),
  ]) assert.throws(() => parseSyntheticFixture(bytes));
});

test('rejects unknown candidate coordinate fields and array coordinates', () => {
  for (const coordinate of [
    { latitude: 1, longitude: 2, extra: true },
    [],
  ]) {
    const fixture = { version: 1, discoveries: {}, observations: { x: { result: { status: 'success', candidates: [{ id: 'place', coordinate }] }, elapsed: 0 } } };
    assert.throws(() => parseSyntheticFixture(Buffer.from(JSON.stringify(fixture))));
  }
});

for (const verifiedCanonicalKey of ['', '  ', '\t\n']) {
  test(`rejects verified candidate key ${JSON.stringify(verifiedCanonicalKey)}`, () => {
    const fixture = { version: 1, discoveries: {}, observations: { x: { result: { status: 'success', candidates: [{ id: 'place', verifiedCanonicalKey }] }, elapsed: 0 } } };
    assert.throws(() => parseSyntheticFixture(Buffer.from(JSON.stringify(fixture))), /Invalid verified candidate key/);
  });
}

for (const [label, coordinate] of [
  ['latitude below minimum', { latitude: -90.01, longitude: 0 }],
  ['latitude above maximum', { latitude: 90.01, longitude: 0 }],
  ['longitude below minimum', { latitude: 0, longitude: -180.01 }],
  ['longitude above maximum', { latitude: 0, longitude: 180.01 }],
]) {
  test(`rejects candidate coordinate with ${label}`, () => {
    const fixture = { version: 1, discoveries: {}, observations: { x: { result: { status: 'success', candidates: [{ id: 'place', coordinate }] }, elapsed: 0 } } };
    assert.throws(() => parseSyntheticFixture(Buffer.from(JSON.stringify(fixture))), /Invalid candidate coordinate/);
  });
}

test('[preservation] accepts inclusive coordinate boundaries and valid candidates outside crawl area', () => {
  const candidates = [
    { id: 'south-west', coordinate: { latitude: -90, longitude: -180 } },
    { id: 'north-east', coordinate: { latitude: 90, longitude: 180 } },
    { id: 'outside-area', coordinate: { latitude: 40, longitude: 40 }, verifiedCanonicalKey: 'canonical-place' },
  ];
  const fixture = { version: 1, discoveries: {}, observations: { x: { result: { status: 'success', candidates }, elapsed: 0 } } };
  const parsed = parseSyntheticFixture(Buffer.from(JSON.stringify(fixture)));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.observations.x.result)), { status: 'success', candidates });
});

test('rejects array-valued failure scope', () => {
  const fixture = { version: 1, discoveries: {}, observations: { x: { result: { status: 'failed', scope: ['global'] }, elapsed: 0 } } };
  assert.throws(() => parseSyntheticFixture(Buffer.from(JSON.stringify(fixture))));
});

test('rejects non-JSON whitespace between values', () => {
  assert.throws(() => parseSyntheticFixture(Buffer.from('{"version":1,\v"discoveries":{},"observations":{}}')));
});

test('rejects invalid references, duplicate IDs per work, whitespace IDs and invalid observations', () => {
  const invalidFixtures = [
    { version: 1, discoveries: { 'work:0,0': { id: 'missing', observationId: 'missing' } }, observations: {} },
    { version: 1, discoveries: { 'work:0,0': { id: '  ', observationId: 'x' } }, observations: { x: { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { 'work:0,0': { id: '  ', observationId: '  ' } }, observations: { '  ': { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { 'work:0,0': { id: 'x', observationId: '  ' } }, observations: { '  ': { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { 'work:0,0': { id: 'same', observationId: 'x' }, 'work:1,0': { id: 'same', observationId: 'y' } }, observations: { x: { result: { status: 'empty' }, elapsed: 0 }, y: { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { 'work:0,0': { id: 'x', observationId: 'x' } }, observations: { x: { result: { status: 'empty' }, elapsed: -1 } } },
  ];
  for (const fixture of invalidFixtures) assert.throws(() => parseSyntheticFixture(Buffer.from(JSON.stringify(fixture))));
});

test('[preservation] rejects matching whitespace-only discovery and observation IDs', () => {
  for (const fixture of [
    { version: 1, discoveries: { 'work:0,0': { id: '  ', observationId: '  ' } }, observations: { '  ': { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { 'work:0,0': { id: 'job', observationId: '  ' } }, observations: { '  ': { result: { status: 'empty' }, elapsed: 0 } } },
    { version: 1, discoveries: { 'work:0,0': { id: '  ', observationId: 'job' } }, observations: { job: { result: { status: 'empty' }, elapsed: 0 } } },
  ]) assert.throws(() => parseSyntheticFixture(Buffer.from(JSON.stringify(fixture))));
});

test('rejects noncanonical core discovery work IDs', () => {
  for (const workId of ['work:00,0', 'work:0,00', 'work:+1,0', 'work:1.0,0', 'work:0,0 ']) {
    const fixture = { version: 1, discoveries: { [workId]: { id: 'job', observationId: 'job' } }, observations: { job: { result: { status: 'empty' }, elapsed: 0 } } };
    assert.throws(() => parseSyntheticFixture(Buffer.from(JSON.stringify(fixture))), /work ID/);
  }
});
