import { validateOperatorConfig, type OperatorConfig } from './operator.js';

type Document = Record<string, unknown> & { reference: string; date: string; scope: string };
type ScopedDocument = Document & { account: string; dataset: string };
type Invocation = OperatorConfig & { operation: 'start' | 'resume'; query: { keyword: string; country: string }; account: string; dataset: string };
type Evidence = { submission: Document; observation: Document; retrieval: Document; pricing: ScopedDocument; rights: ScopedDocument };
type Estimate = { currency: string; amount: number; assumptions: string; uncertainty: string; pricingReference: string };
export type ProviderPreview = { kind: 'blocked'; reason: string } | { kind: 'preview'; invocation: Invocation; evidence: Evidence; estimate: Estimate; authorization: 'not-authorized' };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const doc = (value: unknown): value is Document => {
  if (!object(value) || !text(value.reference) || !text(value.scope) || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
  const date = new Date(value.date);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value.date;
};

/** Documentary attestation preview only: never grants authority or performs I/O. */
export function previewProviderInvocation(input: unknown): ProviderPreview {
  const blocked = (reason: string): ProviderPreview => ({ kind: 'blocked', reason });
  if (!object(input) || !object(input.invocation)) return blocked('Invalid effective invocation');
  const invocation = input.invocation;
  if ((invocation.operation !== 'start' && invocation.operation !== 'resume') || !object(invocation.query) || !text(invocation.query.keyword) || !text(invocation.query.country) || !text(invocation.account) || !text(invocation.dataset)) return blocked('Invalid effective invocation');
  try { validateOperatorConfig({ geometry: invocation.geometry, limits: invocation.limits } as OperatorConfig); }
  catch { return blocked('Invalid effective invocation'); }
  const evidence = object(input.evidence) ? input.evidence : {};
  for (const category of ['submission', 'observation', 'retrieval', 'pricing', 'rights'] as const) {
    const item = evidence[category];
    if (!doc(item) || ((category === 'pricing' || category === 'rights') && (!object(item) || item.account !== invocation.account || item.dataset !== invocation.dataset))) return blocked(`Missing or invalid ${category} evidence`);
  }
  const estimate = input.estimate;
  if (!object(estimate) || !text(estimate.currency) || typeof estimate.amount !== 'number' || !Number.isFinite(estimate.amount) || estimate.amount < 0 || !text(estimate.assumptions) || !text(estimate.uncertainty) || !object(evidence.pricing) || estimate.pricingReference !== evidence.pricing.reference) return blocked('Missing or invalid cost estimate');
  // Snapshot the displayed values; later caller mutation cannot change the preview.
  return structuredClone({ kind: 'preview', invocation: invocation as Invocation, evidence: evidence as Evidence, estimate: estimate as Estimate, authorization: 'not-authorized' });
}
