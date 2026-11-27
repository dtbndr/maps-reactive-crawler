import { isDeepStrictEqual } from 'node:util';
import { readOnlyBoundSnapshot, validateProviderBinding, type ProviderBinding } from './durable-state.js';
import { MAPS_DATASET } from './bright-data-mapping.js';
import { validateOperatorConfig, type OperatorConfig } from './operator.js';
import { effectiveResumeLimits, providerResumeFingerprint } from './provider-resume-fingerprint.js';
export { effectiveResumeLimits } from './provider-resume-fingerprint.js';
import type { TraversalLimits, TraversalState } from './traversal.js';

type Invocation = OperatorConfig & { operation: 'start' | 'resume'; query: { keyword: string; country: string }; account: string; dataset: string; zoom: number; limitPerInput: number };
type Document = Record<string, unknown> & { reference: string; date: string; validThrough: string; scope: string };
type TechnicalDocument = Document & { attestation: { method: string; invocation: Invocation } };
type CommercialDocument = Document & { attestation: { invocation: Invocation; collection: true; storage: true; export: true } };
type Evidence = { submission: TechnicalDocument; observation: TechnicalDocument; retrieval: TechnicalDocument; pricing: CommercialDocument; rights: CommercialDocument };
type Estimate = { currency: string; amount: number; assumptions: string; uncertainty: string; pricingReference: string };
export type ProviderPreview = { kind: 'blocked'; reason: string } | { kind: 'preview'; invocation: Invocation; evidence: Evidence; estimate: Estimate; authorization: 'not-authorized' };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const doc = (value: unknown, today: string): value is Document => object(value) && text(value.reference) && text(value.scope) && validDate(value.date) && validDate(value.validThrough) && value.date <= today && today <= value.validThrough;

/** Documentary attestation preview only: never grants authority or performs I/O. */
export function previewProviderInvocation(input: unknown, today: string = new Date().toISOString().slice(0, 10)): ProviderPreview {
  const blocked = (reason: string): ProviderPreview => ({ kind: 'blocked', reason });
  if (!validDate(today)) return blocked('Invalid current date');
  if (!object(input) || !object(input.invocation)) return blocked('Invalid effective invocation');
  const invocation = input.invocation;
  if ((invocation.operation !== 'start' && invocation.operation !== 'resume') || !object(invocation.query) || !text(invocation.query.keyword) || !text(invocation.query.country) || !text(invocation.account) || !text(invocation.dataset)) return blocked('Invalid effective invocation');
  try {
    if (invocation.dataset !== MAPS_DATASET) return blocked('Invalid effective invocation');
    validateProviderBinding({ version: 2, mode: 'bright-data', keyword: invocation.query.keyword, country: invocation.query.country, zoom: invocation.zoom, limitPerInput: invocation.limitPerInput });
    validateOperatorConfig({ geometry: invocation.geometry, limits: invocation.limits } as OperatorConfig);
  }
  catch { return blocked('Invalid effective invocation'); }
  const evidence = object(input.evidence) ? input.evidence : {};
  for (const category of ['submission', 'observation', 'retrieval', 'pricing', 'rights'] as const) {
    const item = evidence[category];
    if (!doc(item, today) || !object(item.attestation)) return blocked(`Missing or invalid ${category} evidence`);
    const attestation = item.attestation;
    const applicable = category === 'pricing' || category === 'rights'
      ? attestation.collection === true && attestation.storage === true && attestation.export === true && isDeepStrictEqual(attestation.invocation, invocation)
      : attestation.method === category && isDeepStrictEqual(attestation.invocation, invocation);
    if (!applicable) return blocked(`Missing or invalid ${category} evidence`);
  }
  const estimate = input.estimate;
  if (!object(estimate) || !text(estimate.currency) || typeof estimate.amount !== 'number' || !Number.isFinite(estimate.amount) || estimate.amount < 0 || !text(estimate.assumptions) || !text(estimate.uncertainty) || !object(evidence.pricing) || estimate.pricingReference !== evidence.pricing.reference) return blocked('Missing or invalid cost estimate');
  // Snapshot the displayed values; later caller mutation cannot change the preview.
  return structuredClone({ kind: 'preview', invocation: invocation as Invocation, evidence: evidence as Evidence, estimate: estimate as Estimate, authorization: 'not-authorized' });
}

export type ProviderResumePreview = {
  binding: ProviderBinding;
  geometry: TraversalState['geometry'];
  limits: TraversalLimits;
  knownIds: { attemptId: string; id: string }[];
  gaps: TraversalState['gaps'];
  fingerprint: string;
  authorization: 'not-authorized';
};

/** Read only; the fingerprint is a stale-state detector, not consent or authentication. */
export function previewProviderResume(path: string, requested: Partial<TraversalLimits> = {}): ProviderResumePreview {
  const snapshot = readOnlyBoundSnapshot(path);
  if (snapshot.binding.version !== 2) throw new Error('Checkpoint is not provider-bound');
  const limits = effectiveResumeLimits(snapshot.traversal, requested);
  const fingerprint = providerResumeFingerprint(snapshot.binding, snapshot.traversal, snapshot.checkpointPayload, snapshot.ownerPid, limits);
  return { binding: snapshot.binding, geometry: snapshot.traversal.geometry, limits, knownIds: snapshot.traversal.attempts.filter(a => a.knownId !== undefined).map(a => ({ attemptId: a.id, id: a.knownId! })), gaps: snapshot.traversal.gaps, fingerprint, authorization: 'not-authorized' };
}
