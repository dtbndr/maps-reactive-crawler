import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DurableState, readOnlyCheckpointSnapshot } from './durable-state.js';
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
  const latestAttemptByCell = new Map<string, typeof state.attempts[number]>();
  for (const attempt of state.attempts) latestAttemptByCell.set(attempt.cellKey, attempt);
  const currentAttempts = state.attempts.filter(attempt => latestAttemptByCell.get(attempt.cellKey) === attempt);
  const knownIdAttempt = currentAttempts.findLast(attempt => ['dispatched', 'observing', 'uncertain'].includes(attempt.status) && attempt.knownId);
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

  const parkedUnknown = currentAttempts.findLast(attempt => attempt.status === 'uncertain' && !attempt.knownId && state.cells[attempt.cellKey]?.outcome === 'parked');
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
export type OperatorRunResult = { version: 1; command: 'start' | 'resume'; status: OperatorStatus };
type InternalRunResult = { kind: 'completed' | 'partial'; state: import('./traversal.js').TraversalState } | { kind: 'blocked'; reason: OperatorBlockReason; state: import('./traversal.js').TraversalState };
export type OperatorStartOptions = OperatorConfig & { checkpoint: string; fixture: string; onPreflight: (configuration: OperatorConfig) => void; signal?: AbortSignal };
export type OperatorResumeOptions = { checkpoint: string; fixture: string; limits?: Partial<TraversalLimits>; signal?: AbortSignal };

export type OperatorDiscoveryDependencies = { send: SyntheticSend; observe: SyntheticObserve; onPreflight: (configuration: OperatorConfig) => void };

async function executeOperatorDiscovery(state: DurableState, fixture: ParsedSyntheticFixture, dependencies: OperatorDiscoveryDependencies, signal?: AbortSignal): Promise<InternalRunResult> {
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

    try {
      const next = executeDurableDiscovery(state, dependencies.send, dependencies.observe, 'isolated');
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

export type OperatorStatus = {
  version: 1;
  state: 'potentially_interrupted' | 'cancelled' | 'paused' | 'idle';
  headline: string;
  conditions: string[];
  geometry: import('./index.js').Geometry;
  limits: TraversalLimits;
  counters: { admitted: number; submissions: number; activeTime: number };
  frontier: { queued: string[]; running: string[]; parked: string[]; blocked: string[]; discoveryExhausted: boolean };
  discoveryGaps: { id: string | null; cellKey: string; cause: string; scope: 'isolated' | 'global' | null; status: 'unresolved' | 'resolved' | 'skipped' | null }[];
  detailGaps: NonNullable<import('./traversal.js').TraversalState['detailGaps']>;
  pendingDetails: { id: string; identity: string; observationIds: string[]; status: string }[];
  coverage: { cellCenterEligibility: true; returnedPlacesFiltered: false; exhaustive: false; detailComplete: false };
};

const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const nullableLexical = (a: string | null, b: string | null): number => a === null ? b === null ? 0 : -1 : b === null ? 1 : lexical(a, b);
const compareStringArrays = (a: string[], b: string[]): number => {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const compared = lexical(a[index]!, b[index]!);
    if (compared) return compared;
  }
  return a.length - b.length;
};

export function projectOperatorStatus(state: import('./traversal.js').TraversalState, owner: { pid: number | null; alive: boolean } = { pid: null, alive: false }): OperatorStatus {
  const decision = classifyOperatorEligibility(state);
  const staleOwnerWithoutCleanPause = owner.pid !== null && !owner.alive && !state.cleanPauseEvidence;
  const ownerInterrupted = owner.alive || staleOwnerWithoutCleanPause;
  const conditions = new Set<string>();
  if (state.blocked.length) conditions.add('cells');
  if (state.submissions >= state.limits.submissions) conditions.add('submissions');
  if (state.activeTime >= state.limits.activeTime) conditions.add('active_time');
  if (state.recoveryPending || state.activeInterval === true || ownerInterrupted || ['refuse-unknown-id', 'refuse-safe-retry', 'parked-only-uncertainty'].includes(decision.kind)) conditions.add('recovery_pending');
  if (decision.globalGap) conditions.add('global_gap');
  if (state.cancelled) conditions.add('cancelled');
  if (state.paused) conditions.add('paused');
  const sortedConditions = [...conditions].sort();
  const queued = [...state.queue].sort();
  const running = Object.entries(state.cells).filter(([, cell]) => cell.outcome === 'running').map(([key]) => key).sort();
  const parked = Object.entries(state.cells).filter(([, cell]) => cell.outcome === 'parked').map(([key]) => key).sort();
  const blocked = [...state.blocked].sort();
  const latestByCell = new Map<string, typeof state.attempts[number]>();
  for (const attempt of state.attempts) latestByCell.set(attempt.cellKey, attempt);
  const unresolvedCurrent = [...latestByCell.values()].some(attempt => ['reserved', 'dispatched', 'uncertain', 'observing'].includes(attempt.status));
  const discoveryExhausted = !queued.length && !running.length && !parked.length && !blocked.length && !unresolvedCurrent;
  const unresolvedGlobal = state.gaps.some(gap => gap.scope === 'global' && (gap.status ?? 'unresolved') === 'unresolved')
    || state.detailGaps?.some(gap => gap.status === 'unresolved')
    || state.detailWork?.some(work => ['reserved', 'dispatched', 'uncertain'].includes(work.status) && !work.attempts.at(-1)?.knownId);
  const headline = conditions.has('recovery_pending') ? 'recovery_pending'
    : unresolvedGlobal ? 'global_gap'
      : state.cancelled ? 'cancelled'
        : state.paused ? 'paused'
          : conditions.has('submissions') ? 'submissions'
            : conditions.has('active_time') ? 'active_time'
              : conditions.has('cells') ? 'cells'
                : discoveryExhausted ? 'discovery_exhausted' : 'ready';
  const outputState = state.recoveryPending || state.activeInterval === true || ownerInterrupted ? 'potentially_interrupted' : state.cancelled ? 'cancelled' : state.paused || (owner.pid !== null && !!state.cleanPauseEvidence) ? 'paused' : 'idle';
  return {
    version: 1, state: outputState, headline, conditions: sortedConditions,
    geometry: {
      seed: { latitude: state.geometry.seed.latitude, longitude: state.geometry.seed.longitude },
      spacing: state.geometry.spacing,
      area: state.geometry.area.type === 'bbox'
        ? { type: 'bbox', south: state.geometry.area.south, north: state.geometry.area.north, west: state.geometry.area.west, east: state.geometry.area.east }
        : { type: 'radius', radius: state.geometry.area.radius },
    },
    limits: { cells: state.limits.cells, submissions: state.limits.submissions, activeTime: state.limits.activeTime },
    counters: { admitted: state.admitted.length, submissions: state.submissions, activeTime: state.activeTime },
    frontier: { queued, running, parked, blocked, discoveryExhausted },
    discoveryGaps: state.gaps.map(gap => ({ id: gap.id ?? null, cellKey: gap.cellKey, cause: gap.cause, scope: gap.scope ?? null, status: gap.status ?? null }))
      .sort((a, b) => lexical(a.cellKey, b.cellKey) || nullableLexical(a.id, b.id) || lexical(a.cause, b.cause) || nullableLexical(a.scope, b.scope) || nullableLexical(a.status, b.status)),
    detailGaps: (state.detailGaps ?? []).map(gap => ({ workId: gap.workId, identity: gap.identity, observationIds: [...gap.observationIds].sort(), status: gap.status }))
      .sort((a, b) => lexical(a.workId, b.workId) || lexical(a.identity, b.identity) || lexical(a.status, b.status) || compareStringArrays(a.observationIds, b.observationIds)),
    pendingDetails: (state.detailWork ?? []).filter(work => !['completed', 'skipped'].includes(work.status)).map(work => ({ id: work.id, identity: work.identity, observationIds: [...work.observationIds].sort(), status: work.status }))
      .sort((a, b) => lexical(a.id, b.id)),
    coverage: { cellCenterEligibility: true, returnedPlacesFiltered: false, exhaustive: false, detailComplete: false },
  };
}

function response<T extends 'start' | 'resume' | 'cancel'>(command: T, snapshot: import('./traversal.js').TraversalState): { version: 1; command: T; status: OperatorStatus } {
  return { version: 1, command, status: projectOperatorStatus(snapshot) };
}

export function status(options: { checkpoint: string }): OperatorStatus {
  const snapshot = readOnlyCheckpointSnapshot(options.checkpoint);
  return projectOperatorStatus(snapshot.traversal, { pid: snapshot.ownerPid, alive: snapshot.ownerAlive });
}

export type OperatorOccurrence = { id: string; coordinate: { latitude: number; longitude: number } | null; classification: string; sourceCell: string; workId: string; attemptId: string; observationId: string; occurrence: number };
export type OperatorExport = { version: 1; status: OperatorStatus; verifiedPlaces: { canonicalKey: string; observations: OperatorOccurrence[] }[]; unverifiedObservations: OperatorOccurrence[] };
export function exportResults(options: { checkpoint: string }): OperatorExport {
  const snapshot = readOnlyCheckpointSnapshot(options.checkpoint);
  const state = snapshot.traversal;
  const occurrences: OperatorOccurrence[] = state.candidates.map(candidate => {
    const attempt = state.attempts.find(item => item.id === candidate.attemptId);
    if (!attempt) throw new Error('Corrupt traversal checkpoint: occurrence attempt is missing');
    return { id: candidate.id, coordinate: candidate.coordinate ?? null, classification: candidate.classification, sourceCell: candidate.sourceCell, workId: attempt.workId, attemptId: candidate.attemptId, observationId: candidate.observationId, occurrence: candidate.occurrence };
  }).sort((a, b) => lexical(a.observationId, b.observationId));
  const groups = new Map<string, OperatorOccurrence[]>();
  const unverifiedObservations: OperatorOccurrence[] = [];
  for (const occurrence of occurrences) {
    const candidate = state.candidates.find(item => item.observationId === occurrence.observationId)!;
    if (candidate.verifiedCanonicalKey) {
      const group = groups.get(candidate.verifiedCanonicalKey) ?? [];
      group.push(occurrence); groups.set(candidate.verifiedCanonicalKey, group);
    } else unverifiedObservations.push(occurrence);
  }
  return { version: 1, status: projectOperatorStatus(state, { pid: snapshot.ownerPid, alive: snapshot.ownerAlive }), verifiedPlaces: [...groups].sort(([a], [b]) => lexical(a, b)).map(([canonicalKey, observations]) => ({ canonicalKey, observations })), unverifiedObservations };
}

export function cancelCheckpoint(options: { checkpoint: string }): { version: 1; command: 'cancel'; status: OperatorStatus } {
  const acquisition = DurableState.acquireCancelOnly(options.checkpoint);
  try {
    acquisition.cancel();
    acquisition.releaseOwner();
    return response('cancel', acquisition.snapshot());
  } finally { acquisition.close(); }
}

export async function runOperatorWithDependencies(command: 'start' | 'resume', options: OperatorStartOptions | OperatorResumeOptions, dependencies: OperatorDiscoveryDependencies): Promise<OperatorRunResult> {
  const fixture = parseSyntheticFixture(readFileSync(options.fixture));
  if (command === 'start') {
    const startOptions = options as OperatorStartOptions;
    const config = validateOperatorConfig({ geometry: startOptions.geometry, limits: startOptions.limits });
    if (typeof dependencies.onPreflight !== 'function') throw new Error('Preflight callback is required');
    dependencies.onPreflight({ geometry: config.geometry, limits: config.limits });
    DurableState.createBound(startOptions.checkpoint, fixture.identity, createTraversal(config.geometry, config.limits));
  }
  const state = DurableState.openBound(options.checkpoint, fixture.identity);
  try {
    const current = state.readTraversal();
    const requested = command === 'resume' ? (options as OperatorResumeOptions).limits ?? {} : {};
    if (typeof requested !== 'object' || requested === null || Array.isArray(requested)) throw new Error('Invalid resume limits');
    const allowed = ['cells', 'submissions', 'activeTime'];
    if (Object.keys(requested).some(key => !allowed.includes(key))) throw new Error('Invalid resume limit name');
    for (const key of Object.keys(requested) as (keyof TraversalLimits)[]) {
      const value = requested[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(value) || value <= current.limits[key]) throw new Error(`Resume ${key} limit must strictly increase`);
    }
    if (command === 'resume' && Object.keys(requested).length) {
      const limits = { ...current.limits, ...requested };
      validateOperatorConfig({ geometry: current.geometry, limits });
      state.writeTraversal({ ...current, limits });
    }
    const result = await executeOperatorDiscovery(state, fixture, dependencies, options.signal);
    if (result.kind === 'blocked' && result.reason === 'cancelled') state.cancel();
    state.releaseOwner();
    return response(command, state.readTraversalSnapshot());
  } finally { state.close(); }
}

export async function start(options: OperatorStartOptions): Promise<OperatorRunResult> {
  const fixture = parseSyntheticFixture(readFileSync(options.fixture));
  return runOperatorWithDependencies('start', options, {
    send: workId => ({ id: fixture.discoveries[workId]!.id }),
    observe: id => fixture.observations[id]!,
    onPreflight: options.onPreflight,
  });
}

export async function resume(options: OperatorResumeOptions): Promise<OperatorRunResult> {
  const fixture = parseSyntheticFixture(readFileSync(options.fixture));
  return runOperatorWithDependencies('resume', options, {
    send: workId => ({ id: fixture.discoveries[workId]!.id }),
    observe: id => fixture.observations[id]!,
    onPreflight: () => {},
  });
}
