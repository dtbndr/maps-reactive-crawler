import assert from 'node:assert/strict';
import test from 'node:test';

let discovery;
try {
  discovery = await import('../dist/bright-data-discovery.js');
} catch {
  discovery = undefined;
}

function requireAdapter() {
  assert.ok(discovery, 'the discovery adapter module must exist');
  assert.equal(typeof discovery.createBrightDataDiscoveryAdapter, 'function');
  return discovery.createBrightDataDiscoveryAdapter;
}

test('start and resume do not call transport without production evidence and invocation approval', async () => {
  const create = requireAdapter();
  let calls = 0;
  const adapter = create({
    apiKey: 'synthetic-key',
    transport: {
      async submit() { calls++; return { id: 'run-1' }; },
      async observe() { calls++; return { state: 'ready' }; },
    },
  });

  assert.equal((await adapter.start({ keyword: 'coffee', country: 'US', lat: 1, lon: 2 })).kind, 'unsupported');
  assert.equal((await adapter.resume({ id: 'run-1' })).kind, 'unsupported');
  assert.equal(calls, 0);
});

test('submission evidence cannot enable starts when retrieval evidence is absent', async () => {
  const create = requireAdapter();
  let submissions = 0;
  const adapter = create({
    apiKey: 'synthetic-key',
    evidence: { submission: true, observation: false },
    approvals: { invocation: true, pricing: true, rights: true },
    transport: {
      async submit() { submissions++; return { id: 'run-1' }; },
      async observe() { return { state: 'ready' }; },
    },
  });

  assert.equal((await adapter.start({ keyword: 'coffee', country: 'US', lat: 1, lon: 2 })).kind, 'unsupported');
  assert.equal(submissions, 0);
});

test('known-ID-only mode never submits', async () => {
  const create = requireAdapter();
  let submissions = 0;
  const adapter = create({
    apiKey: 'synthetic-key',
    mode: 'known-id-only',
    evidence: { submission: true, observation: true },
    approvals: { invocation: true, pricing: true, rights: true },
    transport: {
      async submit() { submissions++; return { id: 'run-1' }; },
      async observe() { return { state: 'ready' }; },
    },
  });

  assert.equal((await adapter.start({ keyword: 'coffee', country: 'US', lat: 1, lon: 2 })).kind, 'unsupported');
  assert.equal((await adapter.resume({ id: 'known-run' })).kind, 'unsupported');
  assert.equal(submissions, 0);
});

test('pricing and rights gates independently disable provider operations', async (t) => {
  const create = requireAdapter();
  for (const approvals of [
    { invocation: true, pricing: false, rights: true },
    { invocation: true, pricing: true, rights: false },
  ]) {
    await t.test(JSON.stringify(approvals), async () => {
      let calls = 0;
      const adapter = create({
        apiKey: 'synthetic-key',
        evidence: { submission: true, observation: true },
        approvals,
        transport: {
          async submit() { calls++; return { id: 'run-1' }; },
          async observe() { calls++; return { state: 'ready' }; },
        },
      });
      assert.equal((await adapter.start({ keyword: 'coffee', country: 'US', lat: 1, lon: 2 })).kind, 'unsupported');
      assert.equal((await adapter.resume({ id: 'known-run' })).kind, 'unsupported');
      assert.equal(calls, 0);
    });
  }
});

test('transport errors are reduced to credential-free diagnostics', async () => {
  const create = requireAdapter();
  const secret = 'synthetic-secret';
  const adapter = create({
    apiKey: secret,
    evidence: { submission: true, observation: true },
    approvals: { invocation: true, pricing: true, rights: true },
    transport: {
      async submit() { throw new Error(`request failed with Authorization: Bearer ${secret}`); },
      async observe() { throw new Error(`provider echoed ${secret}`); },
    },
  });

  const result = await adapter.start({ keyword: 'coffee', country: 'US', lat: 1, lon: 2 });
  assert.equal(result.kind, 'unsupported');
  assert.equal(JSON.stringify(result).includes(secret), false);
});
