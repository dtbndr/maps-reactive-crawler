import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(args, mode = 'multiple', text = 'synthetic place', country = 'GB') {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', ['test/helpers/location-cli-pty.py', mode, process.execPath, 'dist/cli.js', 'location', '--text', text, '--country', country, ...args]);
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
}

test('configured standalone location uses one loopback request then cache across processes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'location-cli-live-')); const requests = [];
  const server = createServer((req, res) => { requests.push({ url: req.url, agent: req.headers['user-agent'] }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify([{display_name:'First',lat:'51.1',lon:'-0.1',address:{country_code:'gb'}},{display_name:'Second',lat:'52.12345678901234',lon:'-1.123456789012345',address:{country_code:'gb'}}])); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/search`;
    const args = ['--endpoint', endpoint, '--cache', dir, '--user-agent', 'SyntheticTest/1.0 (operator@example.invalid)'];
    for (let i = 0; i < 2; i++) {
      const result = await run(args);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /OpenStreetMap contributors/);
      assert.match(result.output, /Selected candidate: Second/);
      assert.match(result.output, /\{"country":"GB","latitude":52\.12345678901234,"longitude":-1\.123456789012345\}/);
    }
    assert.equal(requests.length, 1);
    assert.equal(requests[0].agent, 'SyntheticTest/1.0 (operator@example.invalid)');
    const url = new URL(requests[0].url, endpoint); assert.equal(url.searchParams.get('q'), 'synthetic place'); assert.equal(url.searchParams.get('countrycodes'), 'gb');
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, {recursive:true, force:true}); }
});

test('live options require explicit complete configuration and exclude fixture', async () => {
  for (const args of [[], ['--endpoint','http://127.0.0.1/search'], ['--endpoint','http://127.0.0.1/search','--cache','cache'], ['--fixture','unused','--endpoint','http://127.0.0.1/search','--cache','cache','--user-agent','test']]) {
    const result = await run(args); assert.equal(result.code, 1, result.output); assert.match(result.output, /resolver unavailable|configuration|exclusive/i);
  }
});

test('concurrent CLI processes share a single in-flight request for the same cache key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'location-cli-race-')); let calls = 0;
  const server = createServer((_req, res) => { calls++; setTimeout(() => res.end(JSON.stringify([{display_name:'Only',lat:'51.1',lon:'-0.1',address:{country_code:'gb'}}])), 200); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const args = ['--endpoint', `http://127.0.0.1:${server.address().port}/search`, '--cache', dir, '--user-agent', 'SyntheticTest/1.0'];
    const results = await Promise.all([run(args, 'single'), run(args, 'single')]);
    for (const result of results) { assert.equal(result.code, 0, result.output); assert.match(result.output, /OpenStreetMap contributors/); }
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, {recursive:true, force:true}); }
});


for (const [code, classification] of [[429, /429.*throttl/i], [403, /403.*deni/i], [500, /Location resolver failed/i]]) test(`CLI reports safe ${code} classification without caching or retrying failures`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'location-cli-status-')); let calls = 0;
  const server = createServer((_req, res) => { calls++; res.writeHead(code); res.end('PRIVATE RESPONSE BODY'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const args = ['--endpoint', `http://127.0.0.1:${server.address().port}/search`, '--cache', dir, '--user-agent', 'SyntheticTest/1.0'];
    for (let i = 0; i < 2; i++) {
        const result = await run(args, 'single'); assert.equal(result.code, 1, result.output);
        assert.match(result.output, classification); assert.doesNotMatch(result.output, /PRIVATE RESPONSE BODY/);
    }
    assert.equal(calls, 2);
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, {recursive:true, force:true}); }
});

test('trimmed query reuses cache across processes while distinct inputs remain distinct', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'location-cli-normalize-')); const requests = [];
  const server = createServer((req, res) => { const url = new URL(req.url, 'http://127.0.0.1'); requests.push([url.pathname, url.searchParams.get('q'), url.searchParams.get('countrycodes')]); res.end(JSON.stringify([{display_name:'Only',lat:'51.1',lon:'-0.1',address:{country_code:url.searchParams.get('countrycodes')}}])); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const args = path => ['--endpoint', endpoint + path, '--cache', dir, '--user-agent', 'SyntheticTest/1.0'];
    for (const [path, text, country] of [['/search','  synthetic place  ','GB'], ['/search','synthetic place','GB'], ['/search','synthetic  place','GB'], ['/other','synthetic place','GB'], ['/search','synthetic place','US']]) {
      const result = await run(args(path), 'single', text, country); assert.equal(result.code, 0, result.output);
    }
    assert.deepEqual(requests, [['/search','synthetic place','gb'], ['/search','synthetic  place','gb'], ['/other','synthetic place','gb'], ['/search','synthetic place','us']]);
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, {recursive:true, force:true}); }
});
