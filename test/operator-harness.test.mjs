import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as operator from '../dist/operator.js';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const geometry = { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 300 } };
const limits = { cells: 1, submissions: 1, activeTime: 10000 };
const response = (directory, fault) => {
  const fixture = join(directory, 'fixture.json');
  const checkpoint = join(directory, 'state.db');
  const witness = join(directory, 'witness.ndjson');
  writeFileSync(fixture, JSON.stringify({ version: 1, discoveries: { 'work:0,0': { id: 'job-0', observationId: 'job-0' } }, observations: { 'job-0': { result: { status: 'empty' }, elapsed: 1 } } }));
  const bytes = readFileSync(fixture);
  const identity = operator.parseSyntheticFixture(bytes).identity;
  DurableState.createBound(checkpoint, identity, createTraversal(geometry, limits));
  const child = spawnSync(process.execPath, ['test/operator-harness.mjs', 'resume', JSON.stringify({ checkpoint, fixture, witness, fault })], { encoding: 'utf8' });
  return { child, checkpoint, witness, identity };
};

test('fresh child witness records preflight then discovery sends without claiming detail-send coverage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-harness-'));
  try {
    const fixture = join(directory, 'fixture.json');
    const checkpoint = join(directory, 'state.db');
    const witness = join(directory, 'witness.ndjson');
    writeFileSync(fixture, JSON.stringify({ version: 1, discoveries: { 'work:0,0': { id: 'job-0', observationId: 'job-0' } }, observations: { 'job-0': { result: { status: 'success', candidates: [{ id: 'place' }] }, elapsed: 1 } } }));
    const options = { checkpoint, fixture, geometry, limits, witness };
    const child = spawnSync(process.execPath, ['test/operator-harness.mjs', 'start', JSON.stringify(options)], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const events = readFileSync(witness, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.type), ['preflight', 'send']);
    assert.deepEqual(events[1], { type: 'send', workId: 'work:0,0' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('send callback fault runs in a fresh test-only child and retains uncertain durable state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-harness-fault-'));
  try {
    const { child, checkpoint, witness, identity } = response(directory, 'send-throw');
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /injected send fault/);
    const events = readFileSync(witness, 'utf8').trim().split('\\n').map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.type), ['send']);
    const state = DurableState.openBound(checkpoint, identity);
    try {
      const traversal = state.readTraversal();
      assert.deepEqual(traversal.attempts.map(({ status, cellKey }) => ({ status, cellKey })), [{ status: 'uncertain', cellKey: '0,0' }]);
      assert.equal(traversal.cells['0,0'].outcome, 'parked');
      assert.equal(traversal.submissions, 1);
      assert.equal(traversal.activeInterval, false);
    } finally { state.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('reserved boundary fault runs in a fresh test-only child and retains reservation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-harness-boundary-'));
  try {
    const { child, checkpoint, identity } = response(directory, 'reserved-boundary');
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /reserved boundary fault/);
    const state = DurableState.openBound(checkpoint, identity);
    try {
      const traversal = state.readTraversal();
      assert.deepEqual(traversal.attempts.map(({ status, cellKey }) => ({ status, cellKey })), [{ status: 'reserved', cellKey: '0,0' }]);
      assert.equal(traversal.submissions, 1);
    } finally { state.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('dispatched boundary fault is isolated to the harness and preserves writer state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'operator-harness-dispatched-'));
  try {
    const fixture = join(directory, 'fixture.json');
    const checkpoint = join(directory, 'state.db');
    const witness = join(directory, 'witness.ndjson');
    writeFileSync(fixture, JSON.stringify({ version: 1, discoveries: { 'work:0,0': { id: 'job-0', observationId: 'job-0' } }, observations: { 'job-0': { result: { status: 'empty' }, elapsed: 1 } } }));
    const child = spawnSync(process.execPath, ['test/operator-harness.mjs', 'start', JSON.stringify({ checkpoint, fixture, geometry, limits, witness, fault: 'dispatched-boundary' })], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /dispatched boundary fault/);
    const identity = operator.parseSyntheticFixture(readFileSync(fixture)).identity;
    const durable = DurableState.openBound(checkpoint, identity);
    try {
      const state = durable.readTraversal();
      assert.deepEqual(state.attempts.map(({ status, cellKey }) => ({ status, cellKey })), [{ status: 'dispatched', cellKey: '0,0' }]);
      assert.equal(state.activeInterval, false);
      assert.equal(state.recoveryPending, false);
      assert.equal(operator.classifyOperatorEligibility(state).kind, 'refuse-unknown-id');
    } finally { durable.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('package exports resolve the root and fence internal package-name imports', () => {
  const root = spawnSync(process.execPath, ['--input-type=module', '-e', "import('maps-reactive-crawler').then(m => { if (typeof m.start !== 'function') process.exitCode = 1 })"], { encoding: 'utf8' });
  assert.equal(root.status, 0, root.stderr);
  const deep = spawnSync(process.execPath, ['--input-type=module', '-e', "import('maps-reactive-crawler/dist/operator.js')"], { encoding: 'utf8' });
  assert.notEqual(deep.status, 0);
  assert.match(deep.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
});

test('npm pack includes required runtime modules and excludes tests and harness', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const paths = pack.files.map(file => file.path);
  for (const runtimeModule of ['dist/index.js', 'dist/operator.js', 'dist/durable-state.js', 'dist/durable-discovery.js', 'dist/traversal.js', 'dist/cli.js']) assert.ok(paths.includes(runtimeModule));
  assert.equal(paths.some(path => path.startsWith('test/')), false);
});
