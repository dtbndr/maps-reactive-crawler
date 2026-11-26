import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DurableState } from './durable-state.js';
import { DurableStopError, executeDurableDiscovery, type SyntheticObserve, type SyntheticSend } from './durable-discovery.js';
import { validateGeometry, type GeometryInput } from './index.js';
import { createTraversal, type DiscoveryResult, type TraversalLimits } from './traversal.js';

export type OperatorConfig = { geometry: GeometryInput; limits: TraversalLimits };
export type SyntheticFixture = {
  version: 1;
  discoveries: Record<string, { id: string; observationId: string }>;
  observations: Record<string, { result: DiscoveryResult; elapsed: number }>;
};
export type ParsedSyntheticFixture = SyntheticFixture & { identity: string };

export type OperatorEligibility = { kind: 'submit' | 'observe-known-id' | 'parked-only-uncertainty' | 'refuse-unknown-id' | 'refuse-safe-retry' | 'recovery-pending' | 'global-gap' | 'paused' | 'cancelled' | 'submission-cap' | 'active-time-cap' | 'exhausted'; cellKey?: string; workId?: string; attemptId?: string; recoveryPending: boolean; globalGap: boolean };

/** Core-aligned eligibility decision; it reads persisted state and never mutates it. */
export function classifyOperatorEligibility(state: import('./traversal.js').TraversalState): OperatorEligibility {
  const blockedUnknownDetail = state.detailWork?.some(work => ['reserved', 'dispatched', 'uncertain'].includes(work.status) && !work.attempts.at(-1)?.knownId);
  const hasGlobalGap = state.gaps.some(gap => gap.scope === 'global' && gap.status !== 'resolved' && gap.status !== 'skipped')
    || state.detailGaps?.some(gap => gap.status === 'unresolved')
    || blockedUnknownDetail;
  const decide = (value: Omit<OperatorEligibility, 'recoveryPending' | 'globalGap'>): OperatorEligibility => ({ ...value, recoveryPending: state.recoveryPending === true, globalGap: Boolean(hasGlobalGap) });
  if (state.cancelled) return decide({ kind: 'cancelled' });
  if (state.paused) return decide({ kind: 'paused' });
  if (state.recoveryPending) return decide({ kind: 'recovery-pending' });

  if (hasGlobalGap) return decide({ kind: 'global-gap' });

  const running = Object.entries(state.cells).find(([, cell]) => cell.outcome === 'running')?.[0];
  const knownIdAttempt = state.attempts.findLast(attempt => ['dispatched', 'observing', 'uncertain'].includes(attempt.status) && attempt.knownId);
  const unknownSafeRetry = state.attempts.at(-1)?.status === 'uncertain' && !state.attempts.at(-1)?.knownId && state.attempts.at(-1)?.safeRetryAuthorization ? state.attempts.at(-1) : undefined;
  const recoverableAttempt = knownIdAttempt ?? unknownSafeRetry;
  const preferRecoverable = Boolean(recoverableAttempt && (state.activeTime >= state.limits.activeTime || state.submissions >= state.limits.submissions || (!running && state.queue.length === 0) || (running && !state.attempts.some(attempt => attempt.cellKey === running && ['reserved', 'dispatched', 'observing'].includes(attempt.status)))));
  const key = preferRecoverable ? recoverableAttempt?.cellKey : running;
  const selected = key ? state.attempts.findLast(attempt => attempt.cellKey === key) : undefined;
  if (selected?.status === 'reserved' && !selected.knownId) return decide({ kind: 'refuse-unknown-id', cellKey: key, workId: selected.workId, attemptId: selected.id });
  if (selected?.status === 'dispatched' && !selected.knownId) return decide({ kind: 'refuse-unknown-id', cellKey: key, workId: selected.workId, attemptId: selected.id });
  if (selected?.status === 'uncertain' && !selected.knownId && selected.safeRetryAuthorization) return decide({ kind: 'refuse-safe-retry', cellKey: key, workId: selected.workId, attemptId: selected.id });
  if (selected && ['dispatched', 'observing', 'uncertain'].includes(selected.status) && selected.knownId) {
    return decide({ kind: 'observe-known-id', cellKey: key, workId: selected.workId, attemptId: selected.id });
  }

  const parkedUnknown = state.attempts.findLast(attempt => attempt.status === 'uncertain' && !attempt.knownId && state.cells[attempt.cellKey]?.outcome === 'parked');
  const hasOtherWork = Boolean(running || state.queue.length || knownIdAttempt);
  if (parkedUnknown && !hasOtherWork) return decide({ kind: 'parked-only-uncertainty', cellKey: parkedUnknown.cellKey, workId: parkedUnknown.workId, attemptId: parkedUnknown.id });

  const cellKey = running ?? state.queue[0];
  if (!cellKey) return decide({ kind: 'exhausted' });
  const attemptForCell = state.attempts.findLast(attempt => attempt.cellKey === cellKey);
  if (attemptForCell?.status === 'uncertain' && !attemptForCell.knownId) return decide({ kind: 'parked-only-uncertainty', cellKey, workId: attemptForCell.workId, attemptId: attemptForCell.id });
  if (state.submissions >= state.limits.submissions) return decide({ kind: 'submission-cap', cellKey, workId: `work:${cellKey}` });
  if (state.activeTime >= state.limits.activeTime) return decide({ kind: 'active-time-cap', cellKey, workId: `work:${cellKey}` });
  return decide({ kind: 'submit', cellKey, workId: `work:${cellKey}` });
}

/** Check a selected submission fixture entry only after eligibility permits a new submission. */
export function precheckOperatorFixture(decision: OperatorEligibility, hasDiscovery: (workId: string) => boolean): string | undefined {
  if (decision.kind !== 'submit' || !decision.workId) return undefined;
  if (!hasDiscovery(decision.workId)) throw new Error(`Missing fixture discovery for ${decision.workId}`);
  return decision.workId;
}

function exactObject(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`Invalid ${label} fields`);
}

export function validateOperatorConfig(config: OperatorConfig): OperatorConfig {
  exactObject(config, ['geometry', 'limits'], 'operator configuration');
  exactObject(config.geometry, ['seed', 'spacing', 'area'], 'geometry');
  exactObject(config.geometry.seed, ['latitude', 'longitude'], 'seed coordinate');
  if (config.geometry.area?.type === 'bbox') exactObject(config.geometry.area, ['type', 'south', 'north', 'west', 'east'], 'bbox');
  else if (config.geometry.area?.type === 'radius') exactObject(config.geometry.area, ['type', 'radius'], 'radius');
  else throw new Error('Invalid area');
  exactObject(config.limits, ['cells', 'submissions', 'activeTime'], 'limits');
  validateGeometry(config.geometry);
  createTraversal(config.geometry, config.limits);
  return config;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// JSON.parse does not expose duplicate object keys, so parse containers explicitly
// while delegating primitive/string decoding to its strict JSON grammar.
function parseUniqueJson(source: string): JsonValue {
  let offset = 0;
  const whitespace = (): void => { while (offset < source.length && /[ \t\n\r]/.test(source[offset]!)) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      if (source[offset] === '\\') { offset += 2; continue; }
      if (source[offset++] === '"') return JSON.parse(source.slice(start, offset)) as string;
    }
    throw new Error('Malformed JSON string');
  };
  const value = (): JsonValue => {
    whitespace();
    if (source[offset] === '{') {
      offset++; whitespace(); const object: { [key: string]: JsonValue } = Object.create(null) as { [key: string]: JsonValue };
      if (source[offset] === '}') { offset++; return object; }
      for (;;) {
        whitespace(); if (source[offset] !== '"') throw new Error('Malformed JSON object key');
        const key = string(); if (Object.hasOwn(object, key)) throw new Error(`Duplicate JSON key: ${key}`);
        whitespace(); if (source[offset++] !== ':') throw new Error('Malformed JSON object');
        object[key] = value(); whitespace();
        const separator = source[offset++]; if (separator === '}') return object;
        if (separator !== ',') throw new Error('Malformed JSON object');
      }
    }
    if (source[offset] === '[') {
      offset++; whitespace(); const array: JsonValue[] = [];
      if (source[offset] === ']') { offset++; return array; }
      for (;;) { array.push(value()); whitespace(); const separator = source[offset++]; if (separator === ']') return array; if (separator !== ',') throw new Error('Malformed JSON array'); }
    }
    if (source[offset] === '"') return string();
    const start = offset;
    while (offset < source.length && !/[ \t\n\r,}\]]/.test(source[offset]!)) offset++;
    if (start === offset) throw new Error('Malformed JSON value');
    return JSON.parse(source.slice(start, offset)) as JsonValue;
  };
  const result = value(); whitespace();
  if (offset !== source.length) throw new Error('Trailing JSON data');
  return result;
}

function validateDiscoveryResult(result: unknown): asserts result is DiscoveryResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid discovery result');
  const item = result as Record<string, unknown>;
  if (item.status === 'empty' || item.status === 'unrecognized') {
    exactObject(item, ['status'], 'discovery result'); return;
  }
  if (item.status === 'failed') {
  if (Object.keys(item).some(key => !['status', 'cause', 'scope'].includes(key)) || typeof item.scope !== 'string' || !['isolated', 'global'].includes(item.scope) || (item.cause !== undefined && typeof item.cause !== 'string')) throw new Error('Invalid failed discovery result');
    return;
  }
  if (item.status !== 'success' || Object.keys(item).some(key => !['status', 'candidates'].includes(key)) || !Array.isArray(item.candidates)) throw new Error('Invalid discovery result');
  for (const candidate of item.candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid discovery candidate');
    const value = candidate as Record<string, unknown>;
    if (Object.keys(value).some(key => !['id', 'coordinate', 'verifiedCanonicalKey'].includes(key)) || typeof value.id !== 'string' || !value.id.trim()) throw new Error('Invalid discovery candidate');
    if (value.coordinate !== undefined && value.coordinate !== null) {
      const coordinate = value.coordinate as Record<string, unknown>;
      if (!coordinate || typeof coordinate !== 'object' || Array.isArray(coordinate)) throw new Error('Invalid candidate coordinate');
      exactObject(coordinate, ['latitude', 'longitude'], 'candidate coordinate');
      const { latitude, longitude } = coordinate;
      if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Invalid candidate coordinate');
    }
    if (value.verifiedCanonicalKey !== undefined && (typeof value.verifiedCanonicalKey !== 'string' || !value.verifiedCanonicalKey.trim())) throw new Error('Invalid verified candidate key');
  }
}

export function parseSyntheticFixture(bytes: Uint8Array): ParsedSyntheticFixture {
  if (!(bytes instanceof Uint8Array)) throw new Error('Fixture must be bytes');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed = parseUniqueJson(source);
  exactObject(parsed, ['version', 'discoveries', 'observations'], 'fixture');
  if (parsed.version !== 1) throw new Error('Unsupported fixture version');
  if (!parsed.discoveries || typeof parsed.discoveries !== 'object' || Array.isArray(parsed.discoveries) || !parsed.observations || typeof parsed.observations !== 'object' || Array.isArray(parsed.observations)) throw new Error('Invalid fixture mappings');
  const discoveries = parsed.discoveries as Record<string, unknown>;
  const observations = parsed.observations as Record<string, unknown>;
  const idsByWork = new Map<string, Set<string>>();
  for (const [workId, value] of Object.entries(discoveries)) {
    const coordinates = workId.startsWith('work:') ? workId.slice('work:'.length).split(',') : [];
    if (coordinates.length !== 2 || coordinates.some(coordinate => !Number.isInteger(Number(coordinate)) || String(Number(coordinate)) !== coordinate)) throw new Error('Invalid work ID');
    exactObject(value, ['id', 'observationId'], 'discovery');
    const { id, observationId } = value;
    if (typeof id !== 'string' || !id.trim() || typeof observationId !== 'string' || !observationId.trim() || id !== observationId || !Object.hasOwn(observations, observationId)) throw new Error('Invalid discovery observation reference');
    const ids = idsByWork.get(workId) ?? new Set<string>();
    if (ids.has(id)) throw new Error('Duplicate ID for work');
    ids.add(id); idsByWork.set(workId, ids);
  }
  for (const [observationId, value] of Object.entries(observations)) {
    exactObject(value, ['result', 'elapsed'], 'observation');
    if (!Number.isFinite(value.elapsed) || (value.elapsed as number) < 0) throw new Error('Invalid observation elapsed time');
    validateDiscoveryResult(value.result);
    if (typeof observationId !== 'string') throw new Error('Invalid observation ID');
  }
  return { version: 1, discoveries: discoveries as SyntheticFixture['discoveries'], observations: observations as SyntheticFixture['observations'], identity: createHash('sha256').update(bytes).digest('hex') };
}

export type OperatorBlockReason = 'cancelled' | 'paused' | 'recovery-pending' | 'global-gap' | 'parked-only-uncertainty' | 'refuse-unknown-id' | 'refuse-safe-retry' | 'active-time-limit';
export type OperatorRunResult = { kind: 'completed' | 'partial'; state: import('./traversal.js').TraversalState } | { kind: 'blocked'; reason: OperatorBlockReason; state: import('./traversal.js').TraversalState };
export type OperatorStartOptions = OperatorConfig & { checkpoint: string; fixture: string; onPreflight: (configuration: OperatorConfig) => void; signal?: AbortSignal };
export type OperatorResumeOptions = { checkpoint: string; fixture: string; limits?: Partial<TraversalLimits>; signal?: AbortSignal };

type DiscoveryTestOverrides = { send?: SyntheticSend; observe?: SyntheticObserve };
let discoveryTestOverrides: DiscoveryTestOverrides | undefined;
/** Private-module test seam; it is intentionally not re-exported from the package entry point. */
export function setOperatorDiscoveryForTest(overrides: DiscoveryTestOverrides | undefined): void { discoveryTestOverrides = overrides; }

async function executeOperatorDiscovery(state: DurableState, fixture: ParsedSyntheticFixture, signal?: AbortSignal): Promise<OperatorRunResult> {
  let partial = state.readTraversal().gaps.some(gap => ['failed', 'unrecognized'].includes(gap.cause) && gap.status !== 'resolved' && gap.status !== 'skipped');
  for (;;) {
    const current = state.readTraversal();
    if (signal?.aborted) return { kind: 'blocked', reason: 'cancelled', state: current };
    const decision = classifyOperatorEligibility(current);
    if (['cancelled', 'paused', 'recovery-pending', 'global-gap', 'parked-only-uncertainty', 'refuse-unknown-id', 'refuse-safe-retry'].includes(decision.kind)) {
      return { kind: 'blocked', reason: decision.kind as OperatorBlockReason, state: current };
    }
    if (['submission-cap', 'active-time-cap', 'exhausted'].includes(decision.kind)) return { kind: partial ? 'partial' : 'completed', state: current };
    if (decision.kind !== 'submit' && decision.kind !== 'observe-known-id') return { kind: 'blocked', reason: 'recovery-pending', state: current };

    if (decision.kind === 'submit') {
      precheckOperatorFixture(decision, workId => Object.hasOwn(fixture.discoveries, workId));
      const discovery = fixture.discoveries[decision.workId!];
      if (!fixture.observations[discovery.observationId]) throw new Error(`Missing fixture observation for ${discovery.observationId}`);
    } else {
      const attempt = current.attempts.find(item => item.id === decision.attemptId);
      if (!attempt?.knownId) return { kind: 'blocked', reason: 'refuse-unknown-id', state: current };
      if (!fixture.observations[attempt.knownId]) throw new Error(`Missing fixture observation for ${attempt.knownId}`);
    }

    const send: SyntheticSend = workId => discoveryTestOverrides?.send?.(workId) ?? { id: fixture.discoveries[workId]!.id };
    const observe: SyntheticObserve = id => discoveryTestOverrides?.observe?.(id) ?? fixture.observations[id]!;
    try {
      const next = executeDurableDiscovery(state, send, observe, 'isolated');
      if (next.gaps.some(gap => gap.cause === 'failed' || gap.cause === 'unrecognized')) partial = true;
    } catch (error) {
      if (error instanceof DurableStopError) return { kind: 'blocked', reason: error.reason === 'active-time-limit' ? 'active-time-limit' : 'recovery-pending', state: state.readTraversal() };
      throw error;
    }
    // Let zero-delay timers scheduled by this invocation abort before another operation.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (signal?.aborted) return { kind: 'blocked', reason: 'cancelled', state: state.readTraversal() };
  }
}

function persistCancellation(checkpoint: string): import('./traversal.js').TraversalState {
  const acquisition = DurableState.acquireCancelOnly(checkpoint);
  try { return acquisition.cancel(); } finally { acquisition.close(); }
}

export function cancelCheckpoint(checkpoint: string): import('./traversal.js').TraversalState {
  return persistCancellation(checkpoint);
}

export async function start(options: OperatorStartOptions): Promise<OperatorRunResult> {
  const fixture = parseSyntheticFixture(readFileSync(options.fixture));
  const config = validateOperatorConfig({ geometry: options.geometry, limits: options.limits });
  if (typeof options.onPreflight !== 'function') throw new Error('Preflight callback is required');
  options.onPreflight({ geometry: config.geometry, limits: config.limits });
  const initial = createTraversal(config.geometry, config.limits);
  DurableState.createBound(options.checkpoint, fixture.identity, initial);
  const state = DurableState.openBound(options.checkpoint, fixture.identity);
  try {
    const result = await executeOperatorDiscovery(state, fixture, options.signal);
    if (result.kind === 'blocked' && result.reason === 'cancelled') return { ...result, state: state.cancel() };
    return result;
  } finally { state.close(); }
}

export async function resume(options: OperatorResumeOptions): Promise<OperatorRunResult> {
  const fixture = parseSyntheticFixture(readFileSync(options.fixture));
  const state = DurableState.openBound(options.checkpoint, fixture.identity);
  try {
    const current = state.readTraversal();
    const requested = options.limits ?? {};
    if (typeof requested !== 'object' || requested === null || Array.isArray(requested)) throw new Error('Invalid resume limits');
    const allowed = ['cells', 'submissions', 'activeTime'];
    if (Object.keys(requested).some(key => !allowed.includes(key))) throw new Error('Invalid resume limit name');
    for (const key of Object.keys(requested) as (keyof TraversalLimits)[]) {
      const value = requested[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= current.limits[key]) throw new Error(`Resume ${key} limit must strictly increase`);
    }
    if (Object.keys(requested).length) {
      const limits = { ...current.limits, ...requested };
      validateOperatorConfig({ geometry: current.geometry, limits });
      state.writeTraversal({ ...current, limits });
    }
    const result = await executeOperatorDiscovery(state, fixture, options.signal);
    if (result.kind === 'blocked' && result.reason === 'cancelled') return { ...result, state: state.cancel() };
    return result;
  } finally { state.close(); }
}
