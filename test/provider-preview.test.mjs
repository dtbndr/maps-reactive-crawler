import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewProviderInvocation } from '../dist/provider-preview.js';

const today = '2026-06-01';
const input = (operation = 'start') => {
  const invocation = { operation, query: { keyword: 'pizza', country: 'GB' }, geometry: { seed: { latitude: 1, longitude: 2 }, spacing: 500, area: { type: 'radius', radius: 1000 } }, limits: { cells: 4, submissions: 3, activeTime: 1000 }, account: 'synthetic-account', dataset: 'synthetic-dataset' };
  const document = { reference: 'fake document', date: '2026-01-01', validThrough: '2026-12-31', scope: 'fake scope' };
  const technical = method => ({ ...document, attestation: { method, operation, dataset: invocation.dataset } });
  const commercial = () => ({ ...document, account: invocation.account, dataset: invocation.dataset, attestation: { invocation: structuredClone(invocation), collection: true, storage: true, export: true } });
  return { invocation, evidence: { submission: technical('submission'), observation: technical('observation'), retrieval: technical('retrieval'), pricing: commercial(), rights: commercial() }, estimate: { currency: 'USD', amount: 5, assumptions: 'up to three submissions', uncertainty: 'actual charges may differ', pricingReference: 'fake document' } };
};
const preview = value => previewProviderInvocation(value, today);
const categories = ['submission', 'observation', 'retrieval', 'pricing', 'rights'];

test('positive controls for start and resume snapshot non-authorizing attestations', () => {
  for (const operation of ['start', 'resume']) {
    const value = input(operation); const result = preview(value);
    assert.deepEqual(result, { kind: 'preview', invocation: value.invocation, evidence: value.evidence, estimate: value.estimate, authorization: 'not-authorized' });
    value.invocation.query.keyword = 'changed';
    assert.equal(result.invocation.query.keyword, 'pizza');
  }
});

test('each evidence category requires current complete dated evidence', () => {
  for (const category of categories) {
    for (const mutate of [v => delete v.evidence[category], v => delete v.evidence[category].attestation, v => { v.evidence[category].date = '2026-02-30'; }, v => { v.evidence[category].date = '2026-06-02'; }, v => { v.evidence[category].validThrough = '2026-05-31'; }, v => delete v.evidence[category].validThrough, v => { v.evidence[category].scope = ''; }]) {
      const value = input(); mutate(value);
      assert.deepEqual(preview(value), { kind: 'blocked', reason: `Missing or invalid ${category} evidence` }, category);
    }
  }
  assert.equal(previewProviderInvocation(input(), 'bad-date').kind, 'blocked');
});

test('technical attestations match each method, operation and dataset', () => {
  for (const category of categories.slice(0, 3)) for (const [key, bad] of [['method', 'other'], ['operation', 'resume'], ['dataset', 'other']]) {
    const value = input(); value.evidence[category].attestation[key] = bad;
    assert.equal(preview(value).kind, 'blocked', `${category} ${key}`);
    delete value.evidence[category].attestation[key];
    assert.equal(preview(value).kind, 'blocked', `${category} missing ${key}`);
  }
});

test('pricing and rights attest to each use and the entire displayed invocation', () => {
  for (const category of ['pricing', 'rights']) {
    for (const key of ['collection', 'storage', 'export']) {
      const value = input(); value.evidence[category].attestation[key] = false;
      assert.equal(preview(value).kind, 'blocked', `${category} ${key}`);
      delete value.evidence[category].attestation[key]; assert.equal(preview(value).kind, 'blocked');
    }
    for (const mutate of [i => { i.account = 'other'; }, i => { i.dataset = 'other'; }, i => { i.operation = 'resume'; }, i => { i.query.keyword = 'other'; }, i => { i.query.country = 'other'; }, i => { i.geometry.area.radius++; }, i => { i.limits.cells++; }]) {
      const value = input(); mutate(value.evidence[category].attestation.invocation);
      assert.equal(preview(value).kind, 'blocked', category);
    }
  }
});

test('invalid estimate and invocation remain blocked', () => {
  for (const [key, invalid] of [['amount', NaN], ['assumptions', ''], ['uncertainty', ''], ['pricingReference', 'other']]) {
    const value = input(); value.estimate[key] = invalid; assert.equal(preview(value).kind, 'blocked');
  }
  const value = input(); delete value.estimate; assert.equal(preview(value).kind, 'blocked');
  const bad = input(); bad.invocation.limits.submissions = -1; assert.equal(preview(bad).kind, 'blocked');
});
