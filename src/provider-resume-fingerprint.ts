import { createHash } from 'node:crypto';
import { validateOperatorConfig } from './operator.js';
import type { ProviderBinding } from './durable-state.js';
import type { TraversalLimits, TraversalState } from './traversal.js';

/** Compute the effective limits identically for preview and guarded acquisition. */
export function effectiveResumeLimits(state: TraversalState, requested: Partial<TraversalLimits>): TraversalLimits {
  if (typeof requested !== 'object' || requested === null || Array.isArray(requested)) throw new Error('Invalid resume limits');
  for (const key of Object.keys(requested)) {
    if (!['cells', 'submissions', 'activeTime'].includes(key)) throw new Error('Invalid resume limit name');
    const name = key as keyof TraversalLimits;
    const value = requested[name];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= state.limits[name]) throw new Error(`Resume ${key} limit must strictly increase`);
  }
  const limits = { ...state.limits, ...requested };
  validateOperatorConfig({ geometry: state.geometry, limits });
  return limits;
}

/** Stale-state detector only; this is neither authentication nor authorization. */
export function providerResumeFingerprint(binding: ProviderBinding, traversal: TraversalState, checkpoint: string, ownerPid: number | null, limits: TraversalLimits): string {
  return createHash('sha256').update(JSON.stringify({ version: 1, binding, traversal, checkpoint, ownerPid, limits })).digest('hex');
}
