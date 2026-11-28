import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createGuardedLocationResolverForTest as createGuardedLocationResolver } from '../dist/guarded-location-resolver.js';

const endpoint = 'https://example.invalid/search';
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'guarded-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const response = { ok: true, status: 200, json: async () => [] };

test('guarded resolver caches validated synthetic results', async t => {
  const dir = await directory(t); let calls = 0;
  const resolver = createGuardedLocationResolver({ directory: dir, endpoint, identification: 'synthetic', transport: async (_url, options) => { calls++; assert.ok(options.signal instanceof AbortSignal); return response; } });
  assert.equal((await resolver('x', 'FR')).attribution, '© OpenStreetMap contributors');
  await resolver('x', 'FR'); assert.equal(calls, 1);
});

test('operator retry is a separate spaced attempt and failure is not cached', async t => {
  const dir = await directory(t); const times = [];
  const resolver = createGuardedLocationResolver({ directory: dir, endpoint, identification: 'synthetic', transport: async () => { times.push(Date.now()); if (times.length === 1) throw Error('synthetic'); return response; } });
  await assert.rejects(resolver('x', 'FR'), /synthetic/); await resolver('x', 'FR');
  assert.equal(times.length, 2); assert.ok(times[1] - times[0] >= 1000);
});

const moduleUrl = pathToFileURL(join(process.cwd(), 'dist/guarded-location-resolver.js')).href;
const script = `import { appendFile } from 'node:fs/promises'; import { createGuardedLocationResolverForTest as createGuardedLocationResolver } from ${JSON.stringify(moduleUrl)};
const [directory, log, query] = process.argv.slice(1);
const resolver = createGuardedLocationResolver({ directory, endpoint: ${JSON.stringify(endpoint)}, identification: 'synthetic', transport: async () => { await appendFile(log, Date.now() + '\\n'); await new Promise(r => setTimeout(r, 200)); return { ok: true, status: 200, json: async () => [] }; } });
await resolver(query, 'FR');`;
function run(dir, log, query) { return new Promise((resolve, reject) => { const p = spawn(process.execPath, ['--input-type=module', '-e', script, dir, log, query], { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', b => err += b); p.on('error', reject); p.on('exit', code => code === 0 ? resolve() : reject(Error(err))); }); }

test('processes combine same-key miss then reuse cache after restart', async t => {
  const dir = await directory(t), log = join(dir, 'requests');
  await Promise.all([run(dir, log, 'same'), run(dir, log, 'same')]); await run(dir, log, 'same');
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1);
});

test('distinct keys and fresh processes observe transport exclusion and spacing', async t => {
  const dir = await directory(t), log = join(dir, 'requests');
  await Promise.all([run(dir, log, 'one'), run(dir, log, 'two')]); await run(dir, log, 'three');
  const times = (await readFile(log, 'utf8')).trim().split('\n').map(Number).sort((a,b) => a-b);
  assert.equal(times.length, 3); assert.ok(times[1]-times[0] >= 1200); assert.ok(times[2]-times[1] >= 1200);
});

test('stale attempt lock and future clock state fail closed without transport', async t => {
  const dir = await directory(t); let calls = 0;
  const resolver = createGuardedLocationResolver({ directory: dir, endpoint, identification: 'synthetic', transport: async () => { calls++; return response; } });
  await mkdir(join(dir, 'attempt.lock')); await assert.rejects(resolver('stale', 'FR'), /lock is held/); await rm(join(dir, 'attempt.lock'), { recursive: true });
  await writeFile(join(dir, 'attempt-time.json'), JSON.stringify({ wallTime: Date.now() + 60000 }));
  await assert.rejects(resolver('clock', 'FR'), /clock regression/); assert.equal(calls, 0);
});

test('timeout leaves attempt locked until unabortable transport settles', async t => {
  const dir = await directory(t); let finish; let signal;
  const resolver = createGuardedLocationResolver({ directory: dir, endpoint, identification: 'synthetic', transport: async (_url, options) => { signal = options.signal; return new Promise(resolve => { finish = () => resolve(response); }); } });
  await assert.rejects(resolver('timeout', 'FR'), /timed out/);
  assert.equal(signal.aborted, true);
  await assert.rejects(readFile(join(dir, 'attempt.lock')), error => error.code === 'EISDIR');
  finish();
  for (let i = 0; i < 100; i++) { try { await mkdir(join(dir, 'attempt.lock')); await rm(join(dir, 'attempt.lock'), { recursive: true }); return; } catch (error) { if (error.code !== 'EEXIST') throw error; await new Promise(r => setTimeout(r, 20)); } }
  assert.fail('attempt lock did not release after settlement');
});

test('crashed process leaves stale attempt lock and requires manual recovery', async t => {
  const dir = await directory(t), log = join(dir, 'requests');
  const crashScript = `import { createGuardedLocationResolverForTest as createGuardedLocationResolver } from ${JSON.stringify(moduleUrl)}; const r = createGuardedLocationResolver({ directory: process.argv[1], endpoint: ${JSON.stringify(endpoint)}, identification: 'synthetic', transport: async () => { process.stdout.write('started\\n'); return new Promise(() => {}); } }); await r('crash', 'FR');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', crashScript, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => reject(Error(`early exit ${code}`))); });
  child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve));
  await assert.rejects(run(dir, log, 'different'), /lock is held/);
  await rm(join(dir, 'attempt.lock'), { recursive: true });
  await run(dir, log, 'different'); assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1);
});

test('fresh process rejects future persisted clock without sending a request', async t => {
  const dir = await directory(t), log = join(dir, 'requests');
  await writeFile(join(dir, 'attempt-time.json'), JSON.stringify({ wallTime: Date.now() + 60000 }));
  await assert.rejects(run(dir, log, 'clock'), /clock regression/);
  await assert.rejects(readFile(log), error => error.code === 'ENOENT');
});
