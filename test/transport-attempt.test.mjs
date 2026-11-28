import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { coordinateTransportAttempt } from '../dist/transport-attempt.js';

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'attempt-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const child = (dir, delay = 0) => new Promise((resolve, reject) => {
  const code = `import { coordinateTransportAttempt } from ${JSON.stringify(new URL('../dist/transport-attempt.js', import.meta.url).href)}; await coordinateTransportAttempt(process.argv[1], async () => { console.log(Date.now()); await new Promise(r => setTimeout(r, Number(process.argv[2]))); });`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code, dir, String(delay)]);
  let out = '', err = ''; p.stdout.on('data', x => out += x); p.stderr.on('data', x => err += x);
  p.on('error', reject); p.on('exit', n => n === 0 ? resolve(Number(out.trim())) : reject(new Error(err)));
});

test('positive control waits before returning the attempt result', async t => {
  const dir = await directory(t), start = performance.now();
  assert.equal(await coordinateTransportAttempt(dir, async () => 42), 42);
  assert.ok(performance.now() - start >= 1100);
});
test('separate processes exclude overlap and a restarted process waits', async t => {
  const dir = await directory(t);
  const [first, second] = await Promise.all([child(dir, 350), child(dir, 350)]);
  assert.ok(Math.abs(first - second) >= 1400, `${first} ${second}`);
  const start = Date.now(), next = await child(dir);
  assert.ok(next - start >= 1100);
});
test('failure releases ownership and retry crosses a fresh boundary', async t => {
  const dir = await directory(t); let first;
  await assert.rejects(coordinateTransportAttempt(dir, async () => { first = performance.now(); throw new Error('synthetic'); }), /synthetic/);
  let second;
  assert.equal(await coordinateTransportAttempt(dir, async () => { second = performance.now(); return 'ok'; }), 'ok');
  assert.ok(second - first >= 1100);
});
test('malformed and future persisted timing fail closed without calling transport', async t => {
  const dir = await directory(t); let called = false;
  for (const value of ['invalid', JSON.stringify({ wallTime: Date.now() + 60000 })]) {
    await writeFile(join(dir, 'attempt-time.json'), value);
    await assert.rejects(coordinateTransportAttempt(dir, async () => { called = true; }));
    assert.equal(called, false);
  }
});
test('stale ownership is never stolen', async t => {
  const dir = await directory(t); await mkdir(join(dir, 'attempt.lock'));
  let called = false;
  await assert.rejects(coordinateTransportAttempt(dir, async () => { called = true; }));
  assert.equal(called, false);
  assert.ok(await readFile(join(dir, 'attempt.lock', 'missing')).catch(e => e.code === 'ENOENT'));
});
test('clock regression during an attempt leaves ownership for manual recovery', async t => {
  const dir = await directory(t), original = Date.now;
  try {
    await assert.rejects(coordinateTransportAttempt(dir, async () => {
      const before = original(); Date.now = () => before - 60000;
    }), /clock regression/);
  } finally { Date.now = original; }
  await assert.rejects(mkdir(join(dir, 'attempt.lock')), { code: 'EEXIST' });
});
test('a killed process leaves a lock that another process cannot steal', async t => {
  const dir = await directory(t);
  const code = `import { coordinateTransportAttempt } from ${JSON.stringify(new URL('../dist/transport-attempt.js', import.meta.url).href)}; await coordinateTransportAttempt(process.argv[1], async () => { console.log('started'); await new Promise(() => {}); });`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { p.stdout.once('data', resolve); p.once('error', reject); p.once('exit', n => reject(new Error(`early exit ${n}`))); });
  p.kill('SIGKILL'); await new Promise(resolve => p.once('exit', resolve));
  await assert.rejects(child(dir), /lock is held/);
});
