// Pure mapping only: no credentials, network, scheduling or provider identity claims.
import { cellCenter, cellKey, isCellEligible } from './index.js';
import type { Attempt, TraversalState } from './traversal.js';
import type { ProviderBinding } from './durable-state.js';

/** Maps a persisted dispatched attempt, not a work-ID-derived coordinate. No transport is performed. */
export function mapAdmittedDiscoveryRequest(state: TraversalState, attempt: Attempt, binding: ProviderBinding) {
  const persisted = state.attempts.find(item => item.id === attempt.id);
  const key = attempt.cellKey;
  const match = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!persisted || persisted.cellKey !== key || persisted.status !== 'dispatched' || !state.admitted.includes(key) || state.cells[key]?.outcome !== 'running' || !match) throw new Error('Attempt is not for an admitted eligible running cell');
  const column = Number(match[1]), row = Number(match[2]);
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row) || cellKey(column, row) !== key || !isCellEligible(state.geometry, column, row)) throw new Error('Attempt is not for an admitted eligible cell');
  const center = cellCenter(state.geometry, column, row);
  return mapDiscoveryRequest({ country: binding.country, keyword: binding.keyword, zoom: binding.zoom, limit: binding.limitPerInput, lat: center.latitude, lon: center.longitude });
}
type RecordValue = Record<string, unknown>;
type Gap = { kind: 'gap'; reason: string };
type Candidate = { name: string; placeId: string; coordinates?: { lat: number; lon: number } };
type Results = Gap | { kind: 'results'; candidates: Candidate[]; gap: boolean; expand: boolean };
const gap = (reason = 'unrecognized-response'): Gap => ({ kind: 'gap', reason });
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export interface MappingInput { country: string; keyword: string; lat: number; lon: number; zoom: number; limit: number }
export function mapDiscoveryRequest(input: MappingInput) {
  if (!/^[A-Z]{2}$/.test(input.country) || !text(input.keyword) || !Number.isFinite(input.lat) || Math.abs(input.lat) > 90 || !Number.isFinite(input.lon) || Math.abs(input.lon) > 180 || !Number.isFinite(input.zoom) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) return gap('invalid-input');
  return { method: 'POST', path: '/datasets/v3/scrape', query: { dataset_id: 'gd_m8ebnr0q2qlklc02fz', notify: 'false', include_errors: 'true', type: 'discover_new', discover_by: 'location' }, body: { input: [{ country: input.country, keyword: input.keyword, lat: input.lat, long: input.lon, zoom_level: input.zoom }], limit_per_input: input.limit } };
}
export function mapSubmitResponse(status: number, body: unknown, retryAfter?: string): Gap | { kind: 'pending'; snapshotId: string; retryAfterSeconds?: number; retryAfterInvalid?: true } | { kind: 'inline'; records: unknown[] } {
  if (status === 429) return gap('rate-limited');
  if (status === 200 && Array.isArray(body)) return { kind: 'inline', records: body };
  if (status !== 202 || !record(body) || !text(body.snapshot_id)) return gap();
  const seconds = retryAfter === undefined ? undefined : Number(retryAfter);
  if (retryAfter !== undefined && (!/^\d+$/.test(retryAfter) || !Number.isSafeInteger(seconds))) return { kind: 'pending', snapshotId: body.snapshot_id, retryAfterInvalid: true };
  return { kind: 'pending', snapshotId: body.snapshot_id, ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }) };
}
export function mapProgressResponse(status: number, body: unknown): Gap | { kind: 'progress'; state: 'starting' | 'running' | 'ready' | 'failed' | 'canceled' } {
  if (status === 429) return gap('rate-limited');
  if (status !== 200 || !record(body)) return gap();
  switch (body.status) {
    case 'starting': case 'running': case 'ready': return { kind: 'progress', state: body.status };
    case 'failed': case 'canceled': return gap(body.status);
    default: return gap();
  }
}
export function mapResultsResponse(status: number, body: unknown, limit: number): Results {
  if (status === 429) return gap('rate-limited');
  if (status !== 200 || !Array.isArray(body) || !Number.isInteger(limit) || limit < 1 || limit > 200) return gap();
  const candidates: Candidate[] = [];
  let incomplete = false;
  for (const item of body) {
    if (!record(item) || !text(item.name) || !text(item.place_id) || 'error' in item) { incomplete = true; continue; }
    const candidate: Candidate = { name: item.name, placeId: item.place_id };
    if (item.lat !== undefined || item.lon !== undefined) {
      if (typeof item.lat !== 'number' || !Number.isFinite(item.lat) || Math.abs(item.lat) > 90 || typeof item.lon !== 'number' || !Number.isFinite(item.lon) || Math.abs(item.lon) > 180) { incomplete = true; continue; }
      candidate.coordinates = { lat: item.lat, lon: item.lon };
    }
    candidates.push(candidate);
  }
  if (incomplete && candidates.length === 0) return gap();
  const hasGap = incomplete || body.length >= limit;
  return { kind: 'results', candidates, gap: hasGap, expand: !hasGap && candidates.length > 0 };
}
