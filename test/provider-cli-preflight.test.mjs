import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runSyntheticOperator } from '../dist/synthetic-bright-data-operator.js';
import { status, exportResults } from '../dist/operator.js';

const cli = (...args) => spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });

test('provider start and resume fail closed before checkpoint mutation', () => {
 const dir = mkdtempSync(join(tmpdir(), 'provider-cli-'));
 try {
  const checkpoint = join(dir, 'state.db');
  for (const command of ['start', 'resume']) {
   const result = cli(command, '--checkpoint', checkpoint, '--provider', 'bright-data');
   assert.equal(result.status, 1);
   assert.equal(result.stdout, '');
   assert.match(result.stderr, /contract.*lifecycle/i);
   assert.match(result.stderr, /pricing/i);
   assert.match(result.stderr, /rights/i);
   assert.match(result.stderr, /confirmation/i);
   assert.match(result.stderr, /not implemented/i);
   assert.equal(existsSync(checkpoint), false);
  }
 } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('provider checkpoint inspection stays local and blocked resume preserves bytes', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'provider-inspect-')); const checkpoint = join(dir, 'state.db');
 try {
  const geometry = { seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 100 } };
  const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
  await runSyntheticOperator('start', { checkpoint, geometry, binding, limits: { cells: 1, submissions: 1, activeTime: 10000 }, bounds: { requestMilliseconds: 1000, activeUntil: Date.now() + 10000, maxObservations: 1, observationDeadline: Date.now() + 10000 } }, {
   submit: async () => ({ status: 202, body: { snapshot_id: 'synthetic-id' } }),
   observe: async () => ({ status: 200, body: { status: 'ready' } }),
   retrieve: async () => ({ status: 200, body: [] }),
  });
  const before = readFileSync(checkpoint);
  for (const [command, expected] of [['status', status({ checkpoint })], ['export', exportResults({ checkpoint })]]) {
   const result = cli(command, '--checkpoint', checkpoint);
   assert.equal(result.status, 0, result.stderr);
   assert.deepEqual(JSON.parse(result.stdout), expected);
  }
  const blocked = cli('resume', '--checkpoint', checkpoint, '--provider', 'bright-data');
  assert.equal(blocked.status, 1);
  assert.deepEqual(readFileSync(checkpoint), before);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
