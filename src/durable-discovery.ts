import type { DurableState } from './durable-state.js';
import { admitNextCell, applyDiscoveryResult, authorizeSafeRetry, authorizeSafeRetryReservation, dispatchSubmission, confirmNoSend, markUncertain, observeKnownId, reserveSubmission, retryKnownIdObservation, recoverKnownId, skipAttempt, authorizeResend, cancelTraversal, reserveDetailSubmission, dispatchDetailSubmission, recordDetailId, completeDetailWork, type DiscoveryResult, type TraversalState } from './traversal.js';

export type SyntheticSend = (workId: string) => { id: string };
export type SyntheticObserve = (id: string) => { result: DiscoveryResult; elapsed: number };
export type SyntheticDetailSend = (workId: string) => { id: string };
export type SyntheticDetailObserve = (id: string) => { elapsed: number };

/** Executes one durable detail item; a persisted dispatch without an ID is never resent. */
export function executeDurableDetail(state: DurableState, workId: string, send: SyntheticDetailSend, observe: SyntheticDetailObserve, clock: { monotonicNow: () => number } = { monotonicNow: () => Number(process.hrtime.bigint()) / 1_000_000 }): TraversalState {
  return executeTimed(state, settle => {
    let current = state.readTraversal();
    if (current.recoveryPending || current.paused || current.cancelled) throw new Error('Detail execution is paused');
    let work = current.detailWork?.find(item => item.id === workId);
    if (!work) throw new Error('Unknown detail work');
    if (work.status === 'dispatched' || work.status === 'uncertain') {
      const attempt = work.attempts.at(-1);
      if (!attempt?.knownId) {
        state.transitionTraversal(value => ({ ...value, detailWork: value.detailWork!.map(item => item.id === workId ? { ...item, status: 'uncertain' as const, attempts: item.attempts.map((a, i) => i === item.attempts.length - 1 ? { ...a, status: 'uncertain' as const } : a) } : item) }));
        throw new Error('Detail dispatch outcome uncertain; refusing resend');
      }
      const observed = observe(attempt.knownId);
      if (!Number.isFinite(observed.elapsed) || observed.elapsed < 0) throw new Error('Invalid detail observation time');
      settle(value => completeDetailWork(value, workId, attempt.knownId!));
      return state.readTraversal();
    }
    settle();
    if (state.readTraversal().activeTime >= state.readTraversal().limits.activeTime) throw new Error('Active-time limit reached before detail reservation');
    state.transitionTraversal(value => reserveDetailSubmission(value, workId));
    state.transitionTraversal(value => dispatchDetailSubmission(value, workId));
    let id: string;
    try { id = send(workId).id; } catch (error) { throw error; }
    if (!id) throw new Error('Synthetic detail send returned no ID');
    state.transitionTraversal(value => recordDetailId(value, workId, id));
    const observed = observe(id);
    if (!Number.isFinite(observed.elapsed) || observed.elapsed < 0) throw new Error('Invalid detail observation time');
    settle(value => completeDetailWork(value, workId, id));
    return state.readTraversal();
  }, clock);
}
export type DurableRetryPolicy = { observationCeiling: number; knownSafeObservationError: (error: unknown) => boolean; submissionCeiling?: number; knownSafeSubmissionError?: (error: unknown) => boolean; retryBaseDelayMs?: number; retryMaxDelayMs?: number; wait?: (milliseconds: number) => void };
function retryDelay(policy: DurableRetryPolicy | undefined, ordinal: number): number {
  const base = policy?.retryBaseDelayMs ?? 0;
  const cap = policy?.retryMaxDelayMs ?? base;
  if (!Number.isSafeInteger(base) || base < 0 || !Number.isSafeInteger(cap) || cap < 0) throw new Error('Invalid retry delay bounds');
  if (base === 0 || cap === 0) return 0;
  return Math.min(cap, base * 2 ** Math.max(0, ordinal - 1));
}
function waitForRetry(policy: DurableRetryPolicy | undefined, delay: number): void {
  if (delay > 0) (policy?.wait ?? (milliseconds => { const end = Date.now() + milliseconds; while (Date.now() < end) {} }))(delay);
}
export type DurableDiscoveryBoundary = 'dequeued' | 'retry-authorized' | 'resend-approved' | 'reserved' | 'dispatched' | 'sent' | 'id-persisted' | 'observing' | 'observed' | 'committed';
let boundaryHook: ((boundary: DurableDiscoveryBoundary) => void) | undefined;
/** Test-only crash injection seam; unset during normal crawler execution. */
export function setDurableDiscoveryBoundaryHookForTest(hook: ((boundary: DurableDiscoveryBoundary) => void) | undefined): void { boundaryHook = hook; }

/** Reserve before send; known IDs are re-observed on restart without another submission. */
function executeDurableDiscoveryImpl(state: DurableState, send: SyntheticSend, observe: SyntheticObserve, uncertaintyScope: 'isolated' | 'global', retryPolicy: DurableRetryPolicy | undefined, reservedRetryId?: string, targetKey?: string, settle?: (change?: (value: TraversalState) => TraversalState) => void): TraversalState {
  let current = state.readTraversal();
  if (current.recoveryPending) throw new Error('Recovery accounting is unresolved');
  if (current.paused || current.cancelled) throw new Error(current.paused ? 'Traversal is paused' : 'Traversal is cancelled');
  let running = targetKey ?? Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')?.[0];
  const latestAttempt = current.attempts.at(-1);
  const latestUncertain = latestAttempt?.status === 'uncertain' ? latestAttempt : undefined;
  const recoverable = current.attempts.findLast(item => ['uncertain', 'dispatched', 'observing'].includes(item.status) && item.knownId)
    ?? (latestUncertain && !latestUncertain.knownId && latestUncertain.safeRetryAuthorization ? latestUncertain : undefined);
  if (!targetKey && recoverable && !current.paused && (current.activeTime >= current.limits.activeTime || current.submissions >= current.limits.submissions || (!running && current.queue.length === 0) || (running && !current.attempts.some(item => item.cellKey === running && ['reserved', 'dispatched', 'observing'].includes(item.status))))) {
    const previousRunning = running;
    running = recoverable.cellKey;
    state.transitionTraversal(value => ({ ...value, queue: previousRunning && previousRunning !== running ? [previousRunning, ...value.queue.filter(key => key !== previousRunning && key !== running)] : value.queue.filter(key => key !== running), cells: { ...value.cells, ...(previousRunning && previousRunning !== running ? { [previousRunning]: { outcome: 'queued' as const } } : {}), [running!]: { outcome: 'running' } } }));
    current = state.readTraversal();
  }
  if (!running && current.queue.length === 0) {
    throw new Error('No recoverable discovery work');
  }
  if (!running) {
    settle?.();
    current = state.readTraversal();
    if (current.activeTime >= current.limits.activeTime) throw new Error('Active-time limit reached before cell admission');
    state.transitionTraversal(value => admitNextCell(value));
    boundaryHook?.('dequeued');
    settle?.();
    current = state.readTraversal();
    if (current.activeTime >= current.limits.activeTime) throw new Error('Active-time limit reached after cell dequeue');
    running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')![0];
  }
  const latestForCell = current.attempts.findLast(item => item.cellKey === running);
  if (latestForCell?.status === 'uncertain' && !latestForCell.knownId && latestForCell.safeRetryAuthorization) {
    const auth = latestForCell.safeRetryAuthorization;
    waitForRetry(retryPolicy, auth.delayMs ?? 0);
    settle?.();
    if (state.readTraversal().activeTime >= state.readTraversal().limits.activeTime) throw new Error('Active-time limit reached before retry reservation');
    state.transitionTraversal(value => authorizeSafeRetryReservation(value, running!, auth.ordinal, auth.ceiling));
    return executeDurableDiscoveryImpl(state, send, observe, uncertaintyScope, retryPolicy, state.readTraversal().attempts.at(-1)!.id, undefined, settle);
  }
  if (latestForCell?.status === 'uncertain' && !latestForCell.knownId) {
    throw new Error('Dispatched attempt has unknown outcome; refusing resend');
  }
  if (latestForCell?.status === 'uncertain' && latestForCell.knownId) {
    running = latestForCell.cellKey;
    state.transitionTraversal(value => ({ ...value, cells: { ...value.cells, [running!]: { outcome: 'running' } } }));
    current = state.readTraversal();
  }
  let reservedThisInvocation = false;
  if (!current.attempts.some(item => item.cellKey === running && ['reserved', 'dispatched', 'observing', 'observed', 'uncertain'].includes(item.status))) {
    settle?.();
    if (state.readTraversal().activeTime >= state.readTraversal().limits.activeTime) throw new Error('Active-time limit reached before reservation');
    state.transitionTraversal(value => reserveSubmission(value, running!));
    reservedThisInvocation = true;
    boundaryHook?.('reserved');
    current = state.readTraversal();
    running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')![0];
  }
  let attempt = current.attempts.findLast(item => item.cellKey === running && ['reserved', 'dispatched', 'observing', 'observed', 'uncertain'].includes(item.status));
  if (!attempt) throw new Error('Running cell has no recoverable attempt');
  const freshlyReserved = attempt.status === 'reserved' && (reservedThisInvocation || attempt.id === reservedRetryId);
  if (attempt.status === 'reserved' && !reservedThisInvocation && attempt.id !== reservedRetryId) {
    state.transitionTraversal(value => ({ ...value, attempts: value.attempts.map(item => item.id === attempt!.id ? { ...item, status: 'uncertain' } : item), cells: { ...value.cells, [running!]: { outcome: 'parked' } }, gaps: [...value.gaps, { cellKey: running!, cause: 'uncertain', scope: uncertaintyScope, status: 'unresolved' }], paused: value.paused || uncertaintyScope === 'global' }));
    throw new Error('Persisted reservation has unknown outcome; refusing send');
  }
  if (freshlyReserved) {
    settle?.();
    if (state.readTraversal().activeTime >= state.readTraversal().limits.activeTime) {
      settle?.(value => confirmNoSend(value, running!));
      throw new Error('Active-time limit reached before dispatch');
    }
    state.transitionTraversal(value => dispatchSubmission(value, running!));
    boundaryHook?.('dispatched');
    settle?.();
    current = state.readTraversal();
    if (current.cancelled) {
      settle?.(value => confirmNoSend(value, running!));
      throw new Error('Traversal is cancelled');
    }
    if (current.activeTime >= current.limits.activeTime) {
      settle?.(value => confirmNoSend(value, running!));
      throw new Error('Active-time limit reached after dispatch');
    }
    attempt = current.attempts.findLast(item => item.cellKey === running)!;
  }
  if (!attempt.knownId && attempt.status === 'dispatched' && !freshlyReserved) {
    state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope));
    throw new Error('Dispatched attempt has unknown outcome; refusing resend');
  }
  if (!attempt.knownId) {
    if (!freshlyReserved || attempt.status !== 'dispatched') throw new Error('Send requires a freshly reserved and dispatched attempt');
    let response: { id: string };
    try { response = send(attempt.workId); }
    catch (error) {
      const priorAttempt = state.readTraversal().attempts.findLast(item => item.cellKey === running && (item.submissionRetryCeiling !== undefined || (item.submissionRetryOrdinal !== undefined && item.retryCeiling !== undefined)));
      const priorSubmissionCeiling = priorAttempt?.submissionRetryCeiling ?? (priorAttempt?.submissionRetryOrdinal !== undefined ? priorAttempt.retryCeiling : undefined);
      const submissionCeiling = priorSubmissionCeiling ?? retryPolicy?.submissionCeiling ?? 0;
      if (retryPolicy?.knownSafeSubmissionError?.(error) && (attempt.submissionRetryOrdinal ?? 0) < submissionCeiling && state.readTraversal().submissions < state.readTraversal().limits.submissions) {
        const retryOrdinal = (attempt.submissionRetryOrdinal ?? 0) + 1;
        state.transitionTraversal(value => {
          const uncertain = { ...value, attempts: value.attempts.map(item => item.id === attempt!.id ? { ...item, status: 'uncertain' as const } : item), gaps: [...value.gaps, { cellKey: running!, cause: 'failed' as const, scope: 'isolated' as const, status: 'unresolved' as const }] };
          return authorizeSafeRetry(uncertain, running!, retryOrdinal, submissionCeiling, retryDelay(retryPolicy, retryOrdinal));
        });
        boundaryHook?.('retry-authorized');
        return executeDurableDiscoveryImpl(state, send, observe, uncertaintyScope, retryPolicy, state.readTraversal().attempts.at(-1)!.id, undefined, settle);
      }
      state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope));
      throw error;
    }
      boundaryHook?.('sent');
    settle?.();
    if (!response.id) {
      state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope));
      throw new Error('Synthetic send returned no durable ID');
    }
    state.transitionTraversal(value => ({ ...value, attempts: value.attempts.map(item => item.id === attempt!.id ? { ...item, knownId: response.id } : item) }));
    boundaryHook?.('id-persisted');
  }
  const id = state.readTraversal().attempts.find(item => item.id === attempt!.id)!.knownId!;
  let response: { result: DiscoveryResult; elapsed: number };
  state.transitionTraversal(value => ({ ...value, attempts: value.attempts.map(item => item.id === attempt!.id ? { ...item, status: 'observing' } : item) }));
  boundaryHook?.('observing');
  const pending = state.readTraversal().attempts.find(item => item.id === attempt!.id)!.observationRetryPendingDelayMs;
  if (pending !== undefined) {
    waitForRetry(retryPolicy, pending);
    state.transitionTraversal(value => ({ ...value, attempts: value.attempts.map(item => { if (item.id !== attempt!.id) return item; const { observationRetryPendingDelayMs: _, ...rest } = item; return rest; }) }));
  }
  try { response = observe(id); }
  catch (error) {
    if (!retryPolicy?.knownSafeObservationError(error)) {
      state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope, id));
      throw error;
    }
    const legacyObservationCeiling = (attempt.submissionRetryOrdinal === undefined || attempt.submissionRetryCeiling !== undefined) && attempt.retryOrdinal !== undefined ? attempt.retryCeiling : undefined;
    const storedCeiling = attempt.observationRetryCeiling ?? legacyObservationCeiling ?? (attempt.submissionRetryOrdinal !== undefined && attempt.submissionRetryCeiling === undefined && attempt.retryCeiling !== undefined ? 0 : attempt.retryOrdinal === undefined ? retryPolicy.observationCeiling : 0);
    if (legacyObservationCeiling !== undefined && (attempt.retryOrdinal ?? 0) < legacyObservationCeiling) {
      state.transitionTraversal(value => ({ ...value, attempts: value.attempts.map(item => { if (item.id !== attempt!.id) return item; const { retryCeiling: _, ...rest } = item; return { ...rest, observationRetryCeiling: legacyObservationCeiling }; }) }));
    }
    if ((state.readTraversal().attempts.find(item => item.id === attempt!.id)!.retryOrdinal ?? 0) >= storedCeiling) {
      state.transitionTraversal(value => markUncertain({ ...value, attempts: value.attempts.map(item => item.id === attempt!.id && item.retryCeiling === undefined ? { ...item, observationRetryCeiling: storedCeiling } : item) }, running!, uncertaintyScope, id));
      throw error;
    }
    while (true) {
      const ordinal = (state.readTraversal().attempts.find(item => item.id === attempt!.id)!.retryOrdinal ?? 0) + 1;
      const delay = retryDelay(retryPolicy, ordinal);
      state.transitionTraversal(value => { const next = retryKnownIdObservation(value, running!, storedCeiling); return { ...next, attempts: next.attempts.map(item => item.id === attempt!.id ? { ...item, observationRetryPendingDelayMs: delay } : item) }; });
      waitForRetry(retryPolicy, delay);
      settle?.();
      state.transitionTraversal(value => ({ ...value, attempts: value.attempts.map(item => { if (item.id !== attempt!.id) return item; const { observationRetryPendingDelayMs: _, ...rest } = item; return rest; }) }));
      try { response = observe(id); break; }
      catch (retryError) {
        if ((state.readTraversal().attempts.find(item => item.id === attempt!.id)!.retryOrdinal ?? 0) >= storedCeiling || !retryPolicy.knownSafeObservationError(retryError)) {
          state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope, id));
          throw retryError;
        }
      }
    }
  }
  boundaryHook?.('observed');
  settle!(value => applyDiscoveryResult(observeKnownId(value, running!, id, 0), running!, response.result));
  boundaryHook?.('committed');
  return state.readTraversal();
}

function executeTimed(state: DurableState, operation: (settle: (change?: (value: TraversalState) => TraversalState) => void) => TraversalState, clock: { monotonicNow: () => number }): TraversalState {
  const current = state.readTraversal();
  if (current.recoveryPending) throw new Error('Recovery accounting is unresolved');
  const hasRecoverableKnownId = current.attempts.some(item => ['uncertain', 'dispatched', 'observing'].includes(item.status) && item.knownId);
  if (current.paused || current.cancelled || (!current.queue.length && !Object.values(current.cells).some(cell => cell.outcome === 'running') && !hasRecoverableKnownId)) return operation(() => {});
  state.beginActiveInterval();
  let last = clock.monotonicNow();
  if (!Number.isFinite(last)) throw new Error('Invalid monotonic clock sample');
  let settlementFailed = false;
  const settle = (change?: (value: TraversalState) => TraversalState): void => {
    try {
      const now = clock.monotonicNow();
      if (!Number.isFinite(now) || now < last) throw new Error('Invalid monotonic clock sample');
      state.transitionTraversal(value => {
        if (value.activeInterval !== true) throw new Error('No active interval to settle');
        const total = value.activeTime + (now - last);
        if (!Number.isFinite(total)) throw new Error('Active time exceeds finite accounting range');
        const updated = { ...value, activeTime: total };
        return change ? change(updated) : updated;
      });
      last = now;
    } catch (error) {
      settlementFailed = true;
      throw error;
    }
  };
  try {
    operation(settle);
    settle();
    state.endActiveInterval();
    return state.readTraversal();
  } catch (error) {
    // A failed settlement leaves the interval marker for explicit recovery; do not
    // sample again or classify the accounting failure as a provider failure.
    if (settlementFailed) throw error;
    // A returned provider exception is a live-process exit, not a crash; account for
    // elapsed work and close the interval so a later invocation can resume traversal.
    settle();
    state.endActiveInterval();
    throw error;
  }
}

export function executeDurableDiscovery(state: DurableState, send: SyntheticSend, observe: SyntheticObserve, uncertaintyScope: 'isolated' | 'global' = 'global', retryPolicy?: DurableRetryPolicy, clock: { monotonicNow: () => number } = { monotonicNow: () => Number(process.hrtime.bigint()) / 1_000_000 }): TraversalState {
  const current = state.readTraversal();
  if (current.recoveryPending) throw new Error('Recovery accounting is unresolved');
  const hasRecoverableKnownId = current.attempts.some(item => ['uncertain', 'dispatched', 'observing'].includes(item.status) && item.knownId);
  if (current.paused || current.cancelled || (!current.queue.length && !Object.values(current.cells).some(cell => cell.outcome === 'running') && !hasRecoverableKnownId)) return executeDurableDiscoveryImpl(state, send, observe, uncertaintyScope, retryPolicy);
  return executeTimed(state, settle => executeDurableDiscoveryImpl(state, send, observe, uncertaintyScope, retryPolicy, undefined, undefined, settle), clock);
}

export function recoverDurableKnownId(state: DurableState, key: string, id: string, evidence: { source: string; evidence: string; timestamp: string }, observe: SyntheticObserve, clock: { monotonicNow: () => number } = { monotonicNow: () => Number(process.hrtime.bigint()) / 1_000_000 }): TraversalState {
  state.transitionTraversal(value => {
    if (value.activeInterval === true) throw new Error('Cannot control traversal during an active interval');
    if (value.recoveryPending) throw new Error('Recovery accounting is unresolved');
    if (value.cancelled || value.paused) throw new Error('Traversal is paused or cancelled');
    const recovered = recoverKnownId(value, key, id, evidence);
    const cells = { ...recovered.cells };
    cells[key] = { outcome: 'running' };
    return { ...recovered, cells, queue: recovered.queue.filter(item => item !== key) };
  });
  // Resume only the specifically recovered ID; the general scheduler may select another queued cell.
  return executeTimed(state, settle => executeDurableDiscoveryImpl(state, () => { throw new Error('Recovered ID must not be resubmitted'); }, observe, 'isolated', undefined, undefined, key, settle), clock);
}
export function skipDurableAttempt(state: DurableState, key: string): TraversalState {
  state.transitionTraversal(value => skipAttempt(value, key));
  return state.readTraversal();
}
export function approveDurableResend(state: DurableState, key: string, rationale: string, send: SyntheticSend, observe: SyntheticObserve, ceiling = 1, clock: { monotonicNow: () => number } = { monotonicNow: () => Number(process.hrtime.bigint()) / 1_000_000 }): TraversalState {
  state.transitionTraversal(value => {
    if (value.activeInterval === true) throw new Error('Cannot control traversal during an active interval');
    if (value.recoveryPending) throw new Error('Recovery accounting is unresolved');
    return authorizeResend(value, key, rationale, ceiling);
  });
  boundaryHook?.('resend-approved');
  return executeTimed(state, settle => executeDurableDiscoveryImpl(state, send, observe, 'isolated', undefined, state.readTraversal().attempts.at(-1)!.id, key, settle), clock);
}
export function recordDurableCleanPause(state: DurableState, evidence: string): TraversalState {
  if (typeof evidence !== 'string' || !evidence.trim()) throw new Error('Clean-pause evidence is required');
  state.transitionTraversal(value => {
    if (value.recoveryPending) throw new Error('Cannot assert clean pause after interruption');
    if (value.activeInterval === true) throw new Error('Cannot assert clean pause during an active interval');
    return { ...value, paused: true, recoveryPending: false, cleanPauseEvidence: { evidence } };
  });
  return state.readTraversal();
}
export function resolveDurableRecoveryDebit(state: DurableState, elapsed: number, evidence: string): TraversalState {
  if (!Number.isFinite(elapsed) || elapsed < 0 || typeof evidence !== 'string' || !evidence.trim()) throw new Error('A finite nonnegative debit and evidence are required');
  state.transitionTraversal(value => {
    if (!value.recoveryPending) throw new Error('No interrupted recovery accounting is pending');
    if (!Number.isFinite(value.activeTime + elapsed)) throw new Error('Recovery debit exceeds finite accounting range');
    return { ...value, activeTime: value.activeTime + elapsed, recoveryPending: false, activeInterval: false, cleanPauseEvidence: undefined, recoveryDebitEvidence: { elapsed, evidence } };
  });
  return state.readTraversal();
}
export function cancelDurableDiscovery(state: DurableState): TraversalState {
  state.transitionTraversal(value => {
    if (value.activeInterval === true) throw new Error('Cannot control traversal during an active interval');
    return cancelTraversal(value);
  });
  return state.readTraversal();
}
