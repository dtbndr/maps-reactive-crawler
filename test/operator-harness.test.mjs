import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const geometry = { seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'radius', radius: 300 } };
const limits = { cells: 1, submissions: 1, activeTime: 10000 };

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
