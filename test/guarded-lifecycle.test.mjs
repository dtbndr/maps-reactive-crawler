import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createGuardedLocationResolver, createGuardedLocationResolverForTest } from '../dist/guarded-location-resolver.js';
import { locationHttpTransport } from '../dist/location-http-transport.js';

const moduleUrl = pathToFileURL(join(process.cwd(), 'dist/guarded-location-resolver.js')).href;
async function setup(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), 'lifecycle-'));
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { directory, endpoint: `http://127.0.0.1:${server.address().port}/search`, identification: 'synthetic' };
}
function child(config, query) {
  const script = `import { createGuardedLocationResolver } from ${JSON.stringify(moduleUrl)}; const r = createGuardedLocationResolver(${JSON.stringify(config)}); try { await r(${JSON.stringify(query)}, 'FR'); } catch (e) { console.error(e.message); process.exitCode=1; }`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; p.stderr.on('data', b => stderr += b);
  return new Promise((resolve, reject) => { p.on('error', reject); p.on('exit', code => resolve({ code, stderr })); });
}

test('error headers do not release ownership while the response body remains active across processes', async t => {
  let release, firstStarted; const headers = new Promise(resolve => { firstStarted = resolve; }); let active = 0, overlap = false, count = 0;
  const config = await setup(t, (_req, res) => { count++; active++; overlap ||= active > 1; res.on('close', () => active--); if (count === 1) { res.writeHead(503); res.write('error'); release = () => res.end(' done'); firstStarted(); } else { res.writeHead(200); res.end('[]'); } });
  const first = child(config, 'one'); await headers;
  const second = child(config, 'two');
  await new Promise(resolve => setTimeout(resolve, 1500)); assert.equal(count, 1);
  release(); const firstResult = await first; const secondResult = await second;
  assert.equal(firstResult.code, 1); assert.match(firstResult.stderr, /Search request failed/); assert.equal(secondResult.code, 0); assert.equal(overlap, false); assert.equal(count, 2);
});

test('redirect is not followed and delayed successful body is consumed before return', async t => {
  let hits = 0;
  const config = await setup(t, (req, res) => { hits++; if (req.url.includes('redirect')) { res.writeHead(302, { location: '/other' }); res.end('redirect'); } else { res.writeHead(200); res.write('['); setTimeout(() => res.end(']'), 100); } });
  const resolver = createGuardedLocationResolver(config);
  await assert.rejects(resolver('redirect', 'FR'), /Search request failed/); assert.equal(hits, 1);
  assert.deepEqual((await resolver('success', 'FR')).candidates, []); assert.equal(hits, 2);
});

test('abort during a delayed response body waits for local socket close', async t => {
  let sendHeaders, bodyStarted, closed, requestArrived;
  const headers = new Promise(resolve => { sendHeaders = resolve; });
  const started = new Promise(resolve => { bodyStarted = resolve; });
  const arrived = new Promise(resolve => { requestArrived = resolve; });
  const socketClosed = new Promise(resolve => { closed = resolve; });
  const config = await setup(t, async (_req, res) => { res.on('close', closed); requestArrived(); await headers; res.writeHead(200); res.write('['); bodyStarted(); });
  const controller = new AbortController();
  const result = locationHttpTransport(config.endpoint, { headers: {}, signal: controller.signal });
  await arrived; await new Promise(resolve => setTimeout(resolve, 100)); sendHeaders(); await started; controller.abort();
  await assert.rejects(result, /aborted/); await socketClosed;
});

test('ignored abort blocks a competing process until late termination and never publishes', async t => {
  let requests = 0;
  const config = await setup(t, (_req, res) => { requests++; res.writeHead(200); res.end('[]'); });
  let finish, signal; const pending = new Promise(resolve => { finish = resolve; });
  const resolver = createGuardedLocationResolverForTest({ ...config, transport: async (_url, options) => { signal = options.signal; await pending; return { ok: true, status: 200, json: async () => [] }; } });
  await assert.rejects(resolver('late', 'FR'), /timed out/); assert.equal(signal.aborted, true);
  const busy = await child(config, 'different'); assert.equal(busy.code, 1); assert.match(busy.stderr, /lock is held/); assert.equal(requests, 0);
  let names = await readdir(config.directory); assert.ok(names.includes('attempt.lock')); assert.ok(!names.some(name => name.endsWith('.json') && name !== 'attempt-time.json'));
  finish(); await new Promise(resolve => setTimeout(resolve, 100));
  names = await readdir(config.directory); assert.ok(!names.some(name => name.endsWith('.json') && name !== 'attempt-time.json'));
  assert.equal((await child(config, 'different')).code, 0); assert.equal(requests, 1);
});


test('oversized error body closes the socket without publishing a cache entry', async t => {
  let closed; const socketClosed = new Promise(resolve => { closed = resolve; });
  const config = await setup(t, (_req, res) => { res.on('close', closed); res.writeHead(503); res.end(Buffer.alloc(1024 * 1024 + 1)); });
  await assert.rejects(createGuardedLocationResolver(config)('oversized', 'FR'), /too large/); await socketClosed;
  assert.ok(!(await readdir(config.directory)).some(name => name.endsWith('.json') && name !== 'attempt-time.json'));
});
