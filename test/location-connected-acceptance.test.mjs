import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

function location(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', ['test/helpers/location-cli-pty.py', 'multiple', process.execPath, 'dist/cli.js', 'location', '--text', 'synthetic place', '--country', 'GB', ...args]);
    let output = ''; child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
}
function snapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return JSON.parse(db.prepare('SELECT payload FROM traversal').get().payload); } finally { db.close(); }
}
function evidence(path, invocation) {
  const doc = { reference: 'synthetic', date: '2020-01-01', validThrough: '2099-01-01', scope: 'synthetic' };
  const technical = method => ({ ...doc, attestation: { method, invocation } });
  const commercial = () => ({ ...doc, attestation: { invocation, collection: true, storage: true, export: true } });
  writeFileSync(path, JSON.stringify({ evidence: { submission: technical('submission'), observation: technical('observation'), retrieval: technical('retrieval'), pricing: commercial(), rights: commercial() }, estimate: { currency: 'USD', amount: 5, assumptions: 'synthetic', uncertainty: 'synthetic', pricingReference: 'synthetic' } }));
}

test('confirmed resolver seed connects to bounded provider start and fresh-process recovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'location-connected-')); let resolverCalls = 0;
  const server = createServer((_req, res) => { resolverCalls++; res.end(JSON.stringify([{ display_name: 'PRIVATE FIRST CANDIDATE', lat: '51.1', lon: '-0.1', address: { country_code: 'gb' } }, { display_name: 'PRIVATE SELECTED CANDIDATE', lat: '52.12345678901234', lon: '-1.123456789012345', address: { country_code: 'gb' } }])); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const selected = await location(['--endpoint', `http://127.0.0.1:${server.address().port}/search`, '--cache', join(dir, 'cache'), '--user-agent', 'SyntheticTest/1.0']);
    assert.equal(selected.code, 0, selected.output);
    assert.match(selected.output, /Selected candidate: PRIVATE SELECTED CANDIDATE/);
    const match = selected.output.match(/\{"country":"GB","latitude":-?[\d.]+,"longitude":-?[\d.]+\}/);
    assert.ok(match, selected.output);
    const { country, latitude, longitude } = JSON.parse(match[0]);
    const invocation = { operation: 'start', query: { keyword: 'pizza', country }, geometry: { seed: { latitude, longitude }, spacing: 500, area: { type: 'radius', radius: 1000 } }, limits: { cells: 1, submissions: 1, activeTime: 2000 }, account: 'synthetic', dataset: 'gd_m8ebnr0q2qlklc02fz', zoom: 15, limitPerInput: 20 };
    const checkpoint = join(dir, 'checkpoint'), evidencePath = join(dir, 'evidence'), calls = join(dir, 'calls');
    const env = { ...process.env, BRIGHT_DATA_API_KEY: 'synthetic-key', SYNTHETIC_CALLS: calls, SYNTHETIC_SCENARIO: 'known-id', NODE_OPTIONS: '--import ./test/helpers/provider-fetch-preload.mjs' };
    const run = (args, phase) => spawnSync('/usr/bin/python3', ['test/helpers/provider-cli-pty.py', 'yes-success', process.execPath, 'dist/cli.js', ...args], { encoding: 'utf8', timeout: 15000, env: { ...env, SYNTHETIC_PHASE: phase } });
    const common = ['--provider', 'bright-data', '--checkpoint', checkpoint, '--evidence', evidencePath, '--account', 'synthetic', '--dataset', invocation.dataset];
    const start = ['start', ...common, '--zoom', '15', '--limit-per-input', '20', '--keyword', 'pizza', '--country', country, '--lat', String(latitude), '--lon', String(longitude), '--spacing-m', '500', '--radius-m', '1000', '--cells', '1', '--submissions', '1', '--active-ms', '2000'];
    const mismatch = structuredClone(invocation); mismatch.geometry.seed.latitude += 1; evidence(evidencePath, mismatch);
    const rejected = run(start, 'start');
    assert.match(rejected.stdout + rejected.stderr, /evidence|attestation/i);
    assert.equal(existsSync(checkpoint), false); assert.equal(existsSync(calls), false);
    evidence(evidencePath, invocation);
    const started = run(start, 'start'); assert.equal(started.status, 0, started.stderr + started.stdout);
    assert.match(started.stdout, /Confirm the displayed seed and provider action/);
    assert.ok(started.stdout.indexOf(String(latitude)) < started.stdout.indexOf('READY: Type yes'));
    const stopped = snapshot(checkpoint);
    assert.deepEqual(stopped.geometry, invocation.geometry);
    assert.equal(stopped.attempts[0].knownId, 'synthetic-id');
    assert.equal(stopped.attempts[0].observationDisposition, 'stopped');
    assert.ok(stopped.gaps.some(g => g.status === 'unresolved'));
    const startStatus = JSON.parse(started.stdout.split(/\r?\n/).find(line => line.startsWith('{"version":1,"command":"start"')));
    assert.ok(startStatus.status.conditions.includes('submissions'));
    assert.deepEqual(startStatus.status.coverage, { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false });
    invocation.operation = 'resume'; invocation.limits.activeTime = 10000; evidence(evidencePath, invocation);
    const resumed = run(['resume', ...common, '--active-ms', '10000'], 'resume'); assert.equal(resumed.status, 0, resumed.stderr + resumed.stdout);
    assert.match(resumed.stdout, /synthetic-id/);
    const final = snapshot(checkpoint); assert.deepEqual(final.geometry, invocation.geometry);
    assert.equal(final.attempts.length, 1); assert.equal(final.attempts[0].knownId, 'synthetic-id'); assert.equal(final.attempts[0].status, 'observed');
    const requests = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(requests.map(r => [r.method, new URL(r.url).pathname]), [['POST', '/datasets/v3/scrape'], ['GET', '/datasets/v3/progress/synthetic-id'], ['GET', '/datasets/v3/progress/synthetic-id'], ['GET', '/datasets/v3/snapshot/synthetic-id']]);
    assert.equal(requests[0].body.input[0].lat, latitude);
    assert.equal(requests[0].body.input[0].long, longitude);
    assert.equal(resolverCalls, 1);
    const exported = spawnSync(process.execPath, ['dist/cli.js', 'export', '--checkpoint', checkpoint], { encoding: 'utf8' });
    assert.equal(exported.status, 0, exported.stderr);
    const exportResult = JSON.parse(exported.stdout);
    assert.deepEqual(exportResult.status.coverage, { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false });
    for (const retained of [JSON.stringify(final), exported.stdout]) assert.doesNotMatch(retained, /PRIVATE FIRST CANDIDATE|PRIVATE SELECTED CANDIDATE/);
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); }
});
