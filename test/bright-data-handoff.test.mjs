import test from 'node:test';
import assert from 'node:assert/strict';
import * as handoff from '../dist/bright-data-handoff.js';

const request = { country: 'US', keyword: 'coffee', lat: 1, lon: 2, zoom: 12, limit: 10 };
const opts = { requestMilliseconds: 20, activeUntil: Date.now() + 1000 };

test('submission hands acknowledged ID to executor without observing', async () => {
  let observations = 0;
  const result = await handoff.submitOnce({ submit: async () => ({ status: 202, body: { snapshot_id: 'id' }, retryAfter: 'bad' }), observe: async () => { observations++; } }, request, opts);
  assert.deepEqual(result, { kind: 'acknowledged', id: 'id', gap: 'invalid-retry-after' });
  assert.equal(observations, 0);
});
test('unacknowledged timeout is uncertain and late response ignored', async () => {
  let calls = 0;
  const result = await handoff.submitOnce({ submit: () => { calls++; return new Promise(resolve => setTimeout(() => resolve({ status: 202, body: { snapshot_id: 'late' } }), 40)); } }, request, opts);
  assert.equal(result.kind, 'uncertain');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls, 1);
  assert.equal(result.kind, 'uncertain');
});
test('observation bounds and unknown or rate limited statuses stop', async () => {
  for (const response of [{ status: 200, body: { status: 'surprise' } }, { status: 429, body: {} }]) {
    const result = await handoff.observeOnce({ observe: async () => response }, 'id', opts);
    assert.equal(result.kind, 'gap');
  }
  let calls = 0;
  const result = await handoff.observeOnce({ observe: async () => { calls++; } }, 'id', { ...opts, activeUntil: Date.now() - 1 });
  assert.equal(result.kind, 'gap');
  assert.equal(calls, 0);
});
test('valid retry hint and ready results are mapped conservatively', async () => {
  const submit = await handoff.submitOnce({ submit: async () => ({ status: 202, body: { snapshot_id: 'id' }, retryAfter: '2' }) }, request, opts);
  assert.deepEqual(submit, { kind: 'acknowledged', id: 'id', retryAfterSeconds: 2 });
  const observed = await handoff.observeOnce({ observe: async () => ({ status: 200, body: { status: 'ready' } }) }, 'id', opts);
  assert.deepEqual(observed, { kind: 'progress', state: 'ready' });
});
test('an ID returned at active cutoff is retained with a gap', async () => {
  const original = Date.now;
  let now = 100;
  Date.now = () => now;
  try {
    const result = await handoff.submitOnce({ submit: async () => { now = 110; return { status: 202, body: { snapshot_id: 'id' } }; } }, request, { requestMilliseconds: 50, activeUntil: 110 });
    assert.deepEqual(result, { kind: 'acknowledged', id: 'id', gap: 'active-time-cutoff' });
  } finally { Date.now = original; }
});
test('late observation cannot expand or return results', async () => {
  const result = await handoff.observeOnce({ observe: () => new Promise(resolve => setTimeout(() => resolve({ status: 200, body: { status: 'ready' } }), 40)) }, 'id', { requestMilliseconds: 5, activeUntil: Date.now() + 100 });
  assert.equal(result.kind, 'gap');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(result.kind, 'gap');
});
test('failures are sanitized and invalid bounds initiate no work', async () => {
  let calls = 0;
  const transport = { submit: async () => { calls++; throw new Error('Bearer synthetic-secret'); } };
  const result = await handoff.submitOnce(transport, request, { ...opts, credential: 'synthetic-secret' });
  assert.equal(result.kind, 'uncertain');
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  await handoff.submitOnce(transport, request, { ...opts, requestMilliseconds: Infinity });
  assert.equal(calls, 1);
});
