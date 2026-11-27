import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewProviderInvocation } from '../dist/provider-preview.js';

const document = { reference: 'synthetic document', date: '2026-01-01', scope: 'synthetic scope' };
const input = () => ({
  invocation: { operation: 'start', query: { keyword: 'pizza', country: 'GB' }, geometry: { seed: { latitude: 1, longitude: 2 }, spacing: 500, area: { type: 'radius', radius: 1000 } }, limits: { cells: 4, submissions: 3, activeTime: 1000 }, account: 'synthetic-account', dataset: 'synthetic-dataset' },
  evidence: { submission: document, observation: document, retrieval: document, pricing: { ...document, account: 'synthetic-account', dataset: 'synthetic-dataset' }, rights: { ...document, account: 'synthetic-account', dataset: 'synthetic-dataset' } },
  estimate: { currency: 'USD', amount: 5, assumptions: 'up to three submissions', uncertainty: 'actual charges may differ', pricingReference: 'synthetic document' },
});

test('preview requires each independent documentary category and an estimable cost', () => {
  for (const category of ['submission', 'observation', 'retrieval', 'pricing', 'rights']) {
    const value = input(); delete value.evidence[category];
    assert.deepEqual(previewProviderInvocation(value), { kind: 'blocked', reason: `Missing or invalid ${category} evidence` });
  }
  const value = input(); delete value.estimate;
  assert.deepEqual(previewProviderInvocation(value), { kind: 'blocked', reason: 'Missing or invalid cost estimate' });
});

test('preview presents effective invocation and uncertain estimate, never authorization', () => {
  const value = input();
  assert.deepEqual(previewProviderInvocation(value), { kind: 'preview', invocation: value.invocation, evidence: value.evidence, estimate: value.estimate, authorization: 'not-authorized' });
  const snapshot = previewProviderInvocation(value);
  value.invocation.query.keyword = 'changed';
  assert.equal(snapshot.invocation.query.keyword, 'pizza');
  value.evidence.pricing.account = 'different';
  assert.equal(previewProviderInvocation(value).kind, 'blocked');
});

test('resume preview includes effective limits; incomplete estimates and malformed evidence are blocked', () => {
  const value = input();
  value.invocation.operation = 'resume';
  value.invocation.limits.submissions = 6;
  assert.equal(previewProviderInvocation(value).invocation.limits.submissions, 6);
  for (const [key, invalid] of [['amount', NaN], ['assumptions', ''], ['uncertainty', ''], ['pricingReference', 'other']]) {
    const bad = input(); bad.estimate[key] = invalid;
    assert.equal(previewProviderInvocation(bad).kind, 'blocked');
  }
  for (const category of ['submission', 'observation', 'retrieval', 'pricing', 'rights']) {
    const bad = input(); bad.evidence[category] = { ...bad.evidence[category], date: '2026-02-30' };
    assert.equal(previewProviderInvocation(bad).kind, 'blocked');
  }
  const bad = input(); bad.invocation.limits.submissions = -1;
  assert.equal(previewProviderInvocation(bad).kind, 'blocked');
});
