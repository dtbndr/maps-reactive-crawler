import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../dist/cli.js';

const startArgs = ['start', '--checkpoint', 'local.db', '--fixture', 'fixture.json', '--lat', '-34.5', '--lon', '-58.4', '--spacing-m', '100', '--radius-m', '500', '--cells', '10', '--submissions', '2', '--active-ms', '1000'];
const resumeArgs = ['resume', '--checkpoint', 'local.db', '--fixture', 'fixture.json'];
const stubLibrary = (overrides = {}) => ({
  start: async options => ({ command: 'start', options }),
  resume: async options => ({ command: 'resume', options }),
  cancelCheckpoint: options => ({ command: 'cancel', checkpoint: options.checkpoint }),
  ...overrides,
});
const invoke = (args, library = stubLibrary()) => {
  const output = { stdout: '', stderr: '' };
  return runCli(args, library, { stdout: text => output.stdout += text, stderr: text => output.stderr += text }).then(code => ({ ...output, code }));
};

test('start accepts negative coordinates and routes parsed configuration', async () => {
  let routed;
  const result = await invoke(startArgs, stubLibrary({ start: async options => { routed = options; return { kind: 'completed' }; } }));
  assert.equal(result.code, 0);
  assert.ok(result.stdout, 'successful start must emit the returned result');
  assert.deepEqual(JSON.parse(result.stdout), { kind: 'completed' });
  assert.equal(routed.checkpoint, 'local.db');
  assert.equal(routed.fixture, 'fixture.json');
  assert.deepEqual(routed.geometry, { seed: { latitude: -34.5, longitude: -58.4 }, spacing: 100, area: { type: 'radius', radius: 500 } });
  assert.deepEqual(routed.limits, { cells: 10, submissions: 2, activeTime: 1000 });
  assert.equal(typeof routed.onPreflight, 'function');
});

test('command parser rejects missing, duplicate, unknown and malformed numeric options', async () => {
  for (const args of [
    ['start'], [...startArgs, '--cells', '4'], [...startArgs, '--wat', '1'], [...startArgs.slice(0, -1), '1x'],
    ['resume', '--checkpoint', 'local.db', '--fixture', 'f', '--cells', '1', '--cells', '2'],
  ]) {
    const result = await invoke(args);
    assert.notEqual(result.code, 0, args.join(' '));
    assert.equal(result.stdout, '', args.join(' '));
    assert.ok(result.stderr, args.join(' '));
  }
});

test('resume forwards explicit equal or decreased caps to library without CLI validation', async () => {
  const calls = [];
  const library = stubLibrary({ resume: async options => { calls.push(options); return { blocked: true }; } });
  const equal = await invoke([...resumeArgs, '--cells', '4'], library);
  const decreased = await invoke([...resumeArgs, '--submissions', '0'], library);
  assert.equal(equal.code, 0);
  assert.equal(decreased.code, 0);
  assert.deepEqual(calls.map(call => call.limits), [{ cells: 4 }, { submissions: 0 }]);
  assert.deepEqual(JSON.parse(equal.stdout), { blocked: true });
  assert.deepEqual(JSON.parse(decreased.stdout), { blocked: true });
});

test('preflight is written to stderr before start collection and returned blocked result succeeds', async () => {
  const events = [];
  const library = stubLibrary({ start: async options => { options.onPreflight({ geometry: 'validated', limits: 'finite' }); events.push('collect'); return { kind: 'blocked' }; } });
  const output = { stdout: '', stderr: '' };
  const code = await runCli(startArgs, library, { stdout: text => { events.push('stdout'); output.stdout += text; }, stderr: text => { events.push('stderr'); output.stderr += text; } });
  assert.equal(code, 0);
  assert.deepEqual(events, ['stderr', 'collect', 'stdout']);
  assert.deepEqual(JSON.parse(output.stderr), { version: 1, type: 'preflight', geometry: 'validated', limits: 'finite' });
  assert.deepEqual(JSON.parse(output.stdout), { kind: 'blocked' });
});

test('library rejection and unexpected exceptions fail with empty stdout', async () => {
  for (const error of [new Error('busy'), new Error('refused'), new Error('unexpected')]) {
    const result = await invoke(resumeArgs, stubLibrary({ resume: async () => { throw error; } }));
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, new RegExp(error.message));
  }
});

test('cancel routes checkpoint and emits returned result', async () => {
  const result = await invoke(['cancel', '--checkpoint', 'local.db']);
  assert.equal(result.code, 0);
  assert.ok(result.stdout, 'successful cancel must emit the returned result');
  assert.deepEqual(JSON.parse(result.stdout), { command: 'cancel', checkpoint: 'local.db' });
});
