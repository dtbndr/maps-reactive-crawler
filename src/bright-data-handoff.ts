// Synthetic, single-operation seam only. The durable executor must record dispatch
// before submit, persist acknowledged IDs before observing, and retain all gaps.
// A timeout cannot cancel remote work and must never cause an automatic resend.
import { mapDiscoveryRequest, mapSubmitResponse, mapProgressResponse, mapResultsResponse, type MappingInput } from './bright-data-mapping.js';
import { sanitizeProviderDiagnostic } from './bright-data-discovery.js';

type Response = { status: number; body: unknown; retryAfter?: string };
export interface SyntheticTransport {
  submit(request: ReturnType<typeof mapDiscoveryRequest>): Promise<Response>;
  observe(id: string): Promise<Response>;
}
export interface HandoffBounds { requestMilliseconds: number; activeUntil: number; credential?: string }
type Gap = { kind: 'gap'; reason: string };
type SubmitResult = Gap | { kind: 'uncertain'; reason: string } | { kind: 'acknowledged'; id: string; retryAfterSeconds?: number; gap?: string } | ReturnType<typeof mapResultsResponse>;
type ObservationResult = Gap | ReturnType<typeof mapProgressResponse>;

function remaining(bounds: HandoffBounds): number {
  if (!Number.isFinite(bounds.requestMilliseconds) || bounds.requestMilliseconds <= 0 || !Number.isFinite(bounds.activeUntil)) return 0;
  return Math.max(0, Math.min(bounds.requestMilliseconds, bounds.activeUntil - Date.now(), 2147483647));
}
async function bounded<T>(action: () => Promise<T>, milliseconds: number, bounds: HandoffBounds): Promise<{ value: T } | { timeout: true } | { error: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(async (): Promise<{ value: T } | { timeout: true } | { error: unknown }> => {
        if (remaining(bounds) <= 0) return { timeout: true };
        try { return { value: await action() }; } catch (error) { return { error }; }
      }),
      new Promise<{ timeout: true }>(resolve => { timer = setTimeout(() => resolve({ timeout: true }), milliseconds); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function submitOnce(transport: Pick<SyntheticTransport, 'submit'>, input: MappingInput, bounds: HandoffBounds): Promise<SubmitResult> {
  const request = mapDiscoveryRequest(input);
  if ('kind' in request) return request;
  const wait = remaining(bounds);
  if (wait <= 0) return { kind: 'gap', reason: 'deadline-or-invalid-bounds' };
  const result = await bounded(() => transport.submit(request), wait, bounds);
  if ('timeout' in result) return { kind: 'uncertain', reason: 'submission-timeout' };
  if ('error' in result) return { kind: 'uncertain', reason: sanitizeProviderDiagnostic(result.error, bounds.credential) };
  const mapped = mapSubmitResponse(result.value.status, result.value.body, result.value.retryAfter);
  if (mapped.kind === 'pending') {
    const cutoff = remaining(bounds) <= 0;
    return { kind: 'acknowledged', id: mapped.snapshotId, ...(mapped.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: mapped.retryAfterSeconds }), ...(mapped.retryAfterInvalid ? { gap: 'invalid-retry-after' } : cutoff ? { gap: 'active-time-cutoff' } : {}) };
  }
  if (remaining(bounds) <= 0) return { kind: 'gap', reason: 'active-time-cutoff' };
  if (mapped.kind === 'inline') return mapResultsResponse(200, mapped.records, input.limit);
  return mapped.reason === 'rate-limited' ? mapped : { kind: 'uncertain', reason: mapped.reason };
}

export async function observeOnce(transport: Pick<SyntheticTransport, 'observe'>, id: string, bounds: HandoffBounds): Promise<ObservationResult> {
  const wait = remaining(bounds);
  if (wait <= 0) return { kind: 'gap', reason: 'deadline-or-invalid-bounds' };
  const result = await bounded(() => transport.observe(id), wait, bounds);
  if ('timeout' in result || remaining(bounds) <= 0) return { kind: 'gap', reason: 'observation-timeout' };
  if ('error' in result) return { kind: 'gap', reason: sanitizeProviderDiagnostic(result.error, bounds.credential) };
  return mapProgressResponse(result.value.status, result.value.body);
}
