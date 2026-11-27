import type { DurableState } from './durable-state.js';
import { submitOnce, observeOnce, retrieveOnce, type SyntheticTransport, type HandoffBounds } from './bright-data-handoff.js';
import { mapAdmittedDiscoveryRequest } from './bright-data-mapping.js';
import { admitNextCell, reserveSubmission, dispatchSubmission, confirmNoSend, markUncertain, applyDiscoveryResult, type Attempt } from './traversal.js';

type Clock = { monotonicNow: () => number; wallNow?: () => number };
const defaultClock: Clock = { monotonicNow: () => performance.now(), wallNow: () => Date.now() };
function wallSample(clock: Clock): number { try { return (clock.wallNow ?? Date.now)(); } catch { return NaN; } }
function retryReady(state: DurableState, attempt: Attempt, clock: Clock): boolean {
  if (!attempt.retryAfterSeconds) return true;
  const now = wallSample(clock);
  if (!Number.isSafeInteger(now) || now < 0 || attempt.retryAfterNotBeforeEpochMs === undefined || attempt.retryAfterLastWallEpochMs === undefined || now < attempt.retryAfterLastWallEpochMs) return false;
  state.transitionTraversal(s => ({ ...s, attempts: s.attempts.map(a => a.id === attempt.id ? { ...a, retryAfterLastWallEpochMs: now } : a) }));
  return now >= attempt.retryAfterNotBeforeEpochMs;
}

/** Offline injected-transport runner. The caller owns the bound checkpoint for the whole invocation. */
export async function runSyntheticBrightData(state: DurableState, transport: SyntheticTransport & { retrieve(id: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> }, bounds: HandoffBounds & { maxObservations: number; observationDeadline: number }, clock: Clock = defaultClock): Promise<{ reason: string }> {
  state.providerBinding();
  for (;;) {
    const current = state.readTraversal();
    if (current.recoveryPending || current.paused || current.cancelled || current.activeInterval) return { reason: 'unavailable' };
    if (current.detailGaps?.some(g => g.status === 'unresolved') || current.detailWork?.some(w => ['reserved', 'dispatched', 'uncertain'].includes(w.status) && !w.attempts.at(-1)?.knownId)) return { reason: 'gap' };
    // A crash can leave a durable dispatch without an acknowledgement. Never resend it.
    const interrupted = current.attempts.filter(a => a.status === 'dispatched' && !a.knownId);
    if (interrupted.length === 1 && current.cells[interrupted[0]!.cellKey]?.outcome === 'running' && current.attempts.findLast(a => a.cellKey === interrupted[0]!.cellKey)?.id === interrupted[0]!.id) {
      state.transitionTraversal(s => markUncertain(s, interrupted[0]!.cellKey));
      return { reason: 'gap' };
    }
    if (current.activeTime >= current.limits.activeTime || Date.now() >= bounds.activeUntil || Date.now() >= bounds.observationDeadline) return { reason: 'active-or-observation-limit' };
    const outstanding = current.attempts.filter(a => a.status === 'observing' || (a.status === 'uncertain' && a.knownId && a.observationDisposition === 'stopped'));
    const gaps = current.gaps.filter(g => g.status !== 'resolved' && g.status !== 'skipped');
    const resumable = outstanding.length === 1 && outstanding[0]!.status === 'uncertain' && gaps.every(g => g.cellKey === outstanding[0]!.cellKey && g.cause === 'uncertain' && g.scope === 'isolated');
    if (gaps.length && !resumable) return { reason: 'gap' };
    if (outstanding.length > 1) return { reason: 'unsupported-recovery' };
    if (outstanding.length === 1) {
      if (!retryReady(state, outstanding[0]!, clock)) return { reason: 'retry-after-pending' };
      await observeDurableBrightData(state, transport, bounds, clock);
      const observed = state.readTraversal();
      if (observed.gaps.some(g => g.status !== 'resolved' && g.status !== 'skipped')) return { reason: 'gap' };
      if (observed.attempts.some(a => a.id === outstanding[0]!.id && a.status === 'observing')) return { reason: 'retry-after-pending' };
      continue;
    }
    if (current.attempts.some(a => ['reserved', 'dispatched', 'uncertain'].includes(a.status))) return { reason: 'unsupported-recovery' };
    if (current.submissions >= current.limits.submissions) return { reason: 'submission-limit' };
    if (!current.queue.length && !Object.values(current.cells).some(c => c.outcome === 'running')) return { reason: 'exhausted' };
    await submitDurableBrightData(state, transport, bounds, clock);
    const after = state.readTraversal();
    if (after.gaps.some(g => g.status !== 'resolved' && g.status !== 'skipped')) return { reason: 'gap' };
    if (!after.attempts.some(a => a.status === 'observing') && after.attempts.at(-1)?.status !== 'observed') return { reason: 'unsupported-recovery' };
  }
}

/** Observe only the checkpoint's acknowledged ID. A gap never triggers a resend. */
export async function observeDurableBrightData(state: DurableState, transport: { observe(id: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }>; retrieve(id: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> }, bounds: HandoffBounds & { maxObservations: number; observationDeadline: number }, clock: Clock = defaultClock): Promise<void> {
  if (!Number.isSafeInteger(bounds.maxObservations) || bounds.maxObservations < 1 || !Number.isFinite(bounds.observationDeadline)) throw new Error('Invalid observation bounds');
  const binding = state.providerBinding();
  const current = state.readTraversal();
  if (current.recoveryPending || current.paused || current.cancelled || current.activeInterval) throw new Error('Traversal is not available for observation');
  const eligible = current.attempts.filter(a => a.knownId && ((a.status === 'observing' && current.cells[a.cellKey]?.outcome === 'running') || (a.status === 'uncertain' && a.observationDisposition === 'stopped' && current.cells[a.cellKey]?.outcome === 'parked')));
  if (eligible.length !== 1) throw new Error('Exactly one acknowledged running attempt is required');
  if (current.activeTime >= current.limits.activeTime) throw new Error('Active-time limit reached');
  const attempt = eligible[0], id = attempt.knownId!;
  if (!retryReady(state, attempt, clock)) return;
  const started = clock.monotonicNow();
  if (!Number.isFinite(started)) throw new Error('Invalid monotonic clock sample');
  const elapsed = () => { const now = clock.monotonicNow(); if (!Number.isFinite(now) || now < started) throw new Error('Invalid monotonic clock sample'); return now - started; };
  const remainingActive = current.limits.activeTime - current.activeTime;
  if (attempt.status === 'uncertain') state.transitionTraversal(s => ({ ...s, cells: { ...s.cells, [attempt.cellKey]: { outcome: 'running' } }, attempts: s.attempts.map(a => a.id === attempt.id ? { ...a, status: 'observing', observationDisposition: 'active' } : a) }));
  const activeDeadline = Date.now() + remainingActive;
  const deadline = Math.min(bounds.activeUntil, bounds.observationDeadline, activeDeadline);
  const effective = { ...bounds, activeUntil: deadline };
  state.transitionTraversal(s => ({ ...s, activeInterval: true }));
  try {
    for (let count = 0; count < bounds.maxObservations; count++) {
      const progress = await observeOnce(transport, id, effective);
      if (progress.kind === 'gap' || elapsed() >= remainingActive) break;
      if (progress.state !== 'ready') continue;
      const result = await retrieveOnce(transport, id, binding.limitPerInput, effective);
      if (result.kind === 'gap' || elapsed() >= remainingActive || Date.now() >= deadline) break;
      // Partial results retain their observations but do not expand.
      state.transitionTraversal(s => {
        const latest = s.attempts.find(a => a.id === attempt.id);
        if (latest?.status !== 'observing' || latest.knownId !== id || s.paused || s.cancelled) throw new Error('Observation no longer applicable');
        const attempts = s.attempts.map(a => a.id === attempt.id ? { ...a, status: 'observed' as const } : a);
        const candidates = result.candidates.map(c => ({ id: c.placeId, name: c.name, ...(c.coordinates ? { coordinate: { latitude: c.coordinates.lat, longitude: c.coordinates.lon } } : {}) }));
        return applyDiscoveryResult({ ...s, attempts, gaps: s.gaps.filter(g => !(g.cellKey === attempt.cellKey && g.cause === 'uncertain' && g.scope === 'isolated' && g.status === 'unresolved')) }, attempt.cellKey, candidates.length ? { status: result.gap ? 'partial' : 'success', candidates } : { status: 'empty' });
      });
      return;
    }
    // Any elapsed local observation deadline is a bounded stop, not a remote cancellation.
    // The caller's deadline can precede activeDeadline by scheduling overhead.
    const stopped = elapsed() >= remainingActive || Date.now() >= deadline;
    state.transitionTraversal(s => { const uncertain = markUncertain(s, attempt.cellKey, 'isolated', id); return stopped ? { ...uncertain, attempts: uncertain.attempts.map(a => a.id === attempt.id ? { ...a, observationDisposition: 'stopped' } : a) } : uncertain; });
  } finally {
    const spent = elapsed();
    state.transitionTraversal(s => ({ ...s, activeTime: s.activeTime + spent, activeInterval: false }));
  }
}

/** Synthetic single submission, including atomic application of understood inline results. */
export async function submitDurableBrightData(state: DurableState, transport: Pick<SyntheticTransport, 'submit'>, bounds: HandoffBounds, clock: Clock = defaultClock): Promise<void> {
  const binding = state.providerBinding();
  let current = state.readTraversal();
  if (current.recoveryPending || current.paused || current.cancelled || current.activeInterval) throw new Error('Traversal is not available for submission');
  if (current.gaps.some(g => g.scope === 'global' && g.status !== 'resolved' && g.status !== 'skipped') || current.detailGaps?.some(g => g.status === 'unresolved') || current.detailWork?.some(w => ['reserved', 'dispatched', 'uncertain'].includes(w.status) && !w.attempts.at(-1)?.knownId)) throw new Error('Global uncertainty blocks submission');
  const started = performance.now();
  state.transitionTraversal(s => ({ ...s, activeInterval: true }));
  try {
  let key = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')?.[0];
  if (!key) {
    state.transitionTraversal(admitNextCell);
    current = state.readTraversal();
    key = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')![0];
  }
  const cell = key;
  // No automatic resend, including a previously confirmed no-send attempt.
  const previous = current.attempts.findLast(a => a.cellKey === cell);
  if (previous) {
    if (previous.status === 'dispatched') state.transitionTraversal(s => markUncertain(s, cell, 'isolated', previous.knownId));
    else if (previous.status === 'reserved') state.transitionTraversal(s => confirmNoSend(s, cell));
    throw new Error('Cell already has a submission attempt');
  }
  state.transitionTraversal(s => reserveSubmission(s, cell));
  state.transitionTraversal(s => dispatchSubmission(s, cell));
  current = state.readTraversal();
  let called = false;
  try {
    const mapped = mapAdmittedDiscoveryRequest(current, current.attempts.at(-1)!, binding);
    if ('kind' in mapped) { state.transitionTraversal(s => confirmNoSend(s, cell)); return; }
    const item = mapped.body.input[0];
    const remaining = Math.max(0, current.limits.activeTime - current.activeTime);
    const result = await submitOnce({ submit: (request, signal) => { called = true; return transport.submit(request, signal); } }, { country: item.country, keyword: item.keyword, lat: item.lat, lon: item.long, zoom: item.zoom_level, limit: mapped.body.limit_per_input }, { ...bounds, activeUntil: Math.min(bounds.activeUntil, Date.now() + remaining) });
    if (result.kind === 'acknowledged') {
      const now = result.retryAfterSeconds ? wallSample(clock) : 0;
      const deadline = now + (result.retryAfterSeconds ?? 0) * 1000;
      const timing = result.retryAfterSeconds && Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(deadline) ? { retryAfterNotBeforeEpochMs: deadline, retryAfterLastWallEpochMs: now } : {};
      state.transitionTraversal(s => {
        const attempts = s.attempts.map(a => a.id === current.attempts.at(-1)!.id ? { ...a, knownId: result.id, status: 'observing' as const, ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }), ...timing } : a);
        const withId = { ...s, attempts };
        return result.gap ? markUncertain(withId, cell, 'isolated', result.id) : withId;
      });
    } else if (result.kind === 'results') {
      state.transitionTraversal(s => {
        const attempt = s.attempts.at(-1);
        if (!attempt || attempt.id !== current.attempts.at(-1)!.id || attempt.status !== 'dispatched' || s.paused || s.cancelled) throw new Error('Inline result no longer applicable');
        const attempts = s.attempts.map(a => a.id === attempt.id ? { ...a, status: 'observed' as const, inlineResult: true as const } : a);
        const candidates = result.candidates.map(c => ({ id: c.placeId, name: c.name, ...(c.coordinates ? { coordinate: { latitude: c.coordinates.lat, longitude: c.coordinates.lon } } : {}) }));
        return applyDiscoveryResult({ ...s, attempts }, cell, candidates.length ? { status: result.gap ? 'partial' : 'success', candidates } : { status: 'empty' });
      });
    } else if (!called) state.transitionTraversal(s => confirmNoSend(s, cell));
    else state.transitionTraversal(s => markUncertain(s, cell));
  } catch (error) {
    const last = state.readTraversal().attempts.at(-1);
    if (last?.status === 'dispatched') state.transitionTraversal(s => called ? markUncertain(s, cell) : confirmNoSend(s, cell));
    throw error;
  }
  } finally {
    const elapsed = Math.max(0, performance.now() - started);
    state.transitionTraversal(s => ({ ...s, activeTime: s.activeTime + elapsed, activeInterval: false }));
  }
}
