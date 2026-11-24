import type { DurableState } from './durable-state.js';
import { admitNextCell, applyDiscoveryResult, authorizeSafeRetry, authorizeSafeRetryReservation, dispatchSubmission, markUncertain, observeKnownId, reserveSubmission, retryKnownIdObservation, recoverKnownId, skipAttempt, authorizeResend, cancelTraversal, type DiscoveryResult, type TraversalState } from './traversal.js';

export type SyntheticSend = (workId: string) => { id: string };
export type SyntheticObserve = (id: string) => { result: DiscoveryResult; elapsed: number };
export type DurableRetryPolicy = { observationCeiling: number; knownSafeObservationError: (error: unknown) => boolean; submissionCeiling?: number; knownSafeSubmissionError?: (error: unknown) => boolean };
export type DurableDiscoveryBoundary = 'dequeued' | 'retry-authorized' | 'reserved' | 'dispatched' | 'sent' | 'id-persisted' | 'observing' | 'observed' | 'committed';
let boundaryHook: ((boundary: DurableDiscoveryBoundary) => void) | undefined;
/** Test-only crash injection seam; unset during normal crawler execution. */
export function setDurableDiscoveryBoundaryHookForTest(hook: ((boundary: DurableDiscoveryBoundary) => void) | undefined): void { boundaryHook = hook; }

/** Reserve before send; known IDs are re-observed on restart without another submission. */
function executeDurableDiscoveryImpl(state: DurableState, send: SyntheticSend, observe: SyntheticObserve, uncertaintyScope: 'isolated' | 'global', retryPolicy: DurableRetryPolicy | undefined, reservedRetryId?: string): TraversalState {
  let current = state.readTraversal();
  if (current.recoveryPending) throw new Error('Recovery accounting is unresolved');
  if (current.paused || current.cancelled) throw new Error(current.paused ? 'Traversal is paused' : 'Traversal is cancelled');
  let running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')?.[0];
  const latestAttempt = current.attempts.at(-1);
  const latestUncertain = latestAttempt?.status === 'uncertain' ? latestAttempt : undefined;
  const recoverable = current.attempts.findLast(item => ['uncertain', 'dispatched', 'observing'].includes(item.status) && item.knownId)
    ?? (latestUncertain && !latestUncertain.knownId && (latestUncertain.submissionRetryOrdinal ?? 0) < (retryPolicy?.submissionCeiling ?? 0) ? latestUncertain : undefined);
  if (recoverable && !current.paused && (current.activeTime >= current.limits.activeTime || current.submissions >= current.limits.submissions || (!running && current.queue.length === 0) || (running && !current.attempts.some(item => item.cellKey === running && ['reserved', 'dispatched', 'observing'].includes(item.status))))) {
    const previousRunning = running;
    running = recoverable.cellKey;
    state.transitionTraversal(value => ({ ...value, queue: previousRunning && previousRunning !== running ? [previousRunning, ...value.queue.filter(key => key !== previousRunning && key !== running)] : value.queue.filter(key => key !== running), cells: { ...value.cells, ...(previousRunning && previousRunning !== running ? { [previousRunning]: { outcome: 'queued' as const } } : {}), [running!]: { outcome: 'running' } } }));
    current = state.readTraversal();
  }
  if (!running && current.queue.length === 0) {
    throw new Error('No recoverable discovery work');
  }
  if (!running) {
    state.transitionTraversal(value => admitNextCell(value));
    boundaryHook?.('dequeued');
    current = state.readTraversal();
    running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')![0];
  }
  const latestForCell = current.attempts.findLast(item => item.cellKey === running);
  if (latestForCell?.status === 'uncertain' && !latestForCell.knownId && latestForCell.safeRetryAuthorization) {
    const auth = latestForCell.safeRetryAuthorization;
    state.transitionTraversal(value => authorizeSafeRetryReservation(value, running!, auth.ordinal, auth.ceiling));
    return executeDurableDiscoveryImpl(state, send, observe, uncertaintyScope, retryPolicy, state.readTraversal().attempts.at(-1)!.id);
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
    state.transitionTraversal(value => dispatchSubmission(value, running!));
    boundaryHook?.('dispatched');
    attempt = state.readTraversal().attempts.findLast(item => item.cellKey === running)!;
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
      if (retryPolicy?.knownSafeSubmissionError?.(error) && (attempt.submissionRetryOrdinal ?? 0) < (retryPolicy.submissionCeiling ?? 0) && state.readTraversal().submissions < state.readTraversal().limits.submissions) {
        const retryOrdinal = (attempt.submissionRetryOrdinal ?? 0) + 1;
        state.transitionTraversal(value => {
          const uncertain = { ...value, attempts: value.attempts.map(item => item.id === attempt!.id ? { ...item, status: 'uncertain' as const } : item), gaps: [...value.gaps, { cellKey: running!, cause: 'failed' as const, scope: 'isolated' as const, status: 'unresolved' as const }] };
          return authorizeSafeRetry(uncertain, running!, retryOrdinal, retryPolicy.submissionCeiling!);
        });
        boundaryHook?.('retry-authorized');
        return executeDurableDiscoveryImpl(state, send, observe, uncertaintyScope, retryPolicy, state.readTraversal().attempts.at(-1)!.id);
      }
      state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope));
      throw error;
    }
    boundaryHook?.('sent');
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
  try { response = observe(id); }
  catch (error) {
    if (!retryPolicy?.knownSafeObservationError(error)) {
      state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope, id));
      throw error;
    }
    let retries = 0;
    const storedCeiling = attempt.retryCeiling ?? retryPolicy.observationCeiling;
    while (true) {
      state.transitionTraversal(value => retryKnownIdObservation(value, running!, storedCeiling));
      retries++;
      try { response = observe(id); break; }
      catch (retryError) {
        if (retries >= storedCeiling || !retryPolicy.knownSafeObservationError(retryError)) {
          state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope, id));
          throw retryError;
        }
      }
    }
  }
  boundaryHook?.('observed');
  state.transitionTraversal(value => applyDiscoveryResult(observeKnownId(value, running!, id, response.elapsed), running!, response.result));
  boundaryHook?.('committed');
  return state.readTraversal();
}

export function executeDurableDiscovery(state: DurableState, send: SyntheticSend, observe: SyntheticObserve, uncertaintyScope: 'isolated' | 'global' = 'global', retryPolicy?: DurableRetryPolicy): TraversalState {
  return executeDurableDiscoveryImpl(state, send, observe, uncertaintyScope, retryPolicy);
}

export function recoverDurableKnownId(state: DurableState, key: string, id: string, evidence: { source: string; evidence: string; timestamp: string }, observe: SyntheticObserve): TraversalState {
  state.transitionTraversal(value => {
    if (value.recoveryPending) throw new Error('Recovery accounting is unresolved');
    const recovered = recoverKnownId(value, key, id, evidence);
    const cells = { ...recovered.cells };
    for (const [cellKey, cell] of Object.entries(cells)) if (cell.outcome === 'running' && cellKey !== key) cells[cellKey] = { outcome: 'queued' };
    cells[key] = { outcome: 'running' };
    return { ...recovered, cells, queue: recovered.queue.filter(item => item !== key) };
  });
  // Resume only the specifically recovered ID; the general scheduler may select another queued cell.
  return executeDurableDiscoveryImpl(state, () => { throw new Error('Recovered ID must not be resubmitted'); }, observe, 'isolated', undefined);
}
export function skipDurableAttempt(state: DurableState, key: string): TraversalState {
  state.transitionTraversal(value => skipAttempt(value, key));
  return state.readTraversal();
}
export function approveDurableResend(state: DurableState, key: string, rationale: string, send: SyntheticSend, observe: SyntheticObserve): TraversalState {
  state.transitionTraversal(value => {
    if (value.recoveryPending) throw new Error('Recovery accounting is unresolved');
    return authorizeResend(value, key, rationale);
  });
  return executeDurableDiscoveryImpl(state, send, observe, 'isolated', undefined, state.readTraversal().attempts.at(-1)!.id);
}
export function recordDurableCleanPause(state: DurableState, evidence: string): TraversalState {
  if (typeof evidence !== 'string' || !evidence.trim()) throw new Error('Clean-pause evidence is required');
  state.transitionTraversal(value => {
    if (value.recoveryPending) throw new Error('Cannot assert clean pause after interruption');
    return { ...value, paused: true, recoveryPending: false, cleanPauseEvidence: { evidence } };
  });
  return state.readTraversal();
}
export function resolveDurableRecoveryDebit(state: DurableState, elapsed: number, evidence: string): TraversalState {
  if (!Number.isFinite(elapsed) || elapsed < 0 || typeof evidence !== 'string' || !evidence.trim()) throw new Error('A finite nonnegative debit and evidence are required');
  state.transitionTraversal(value => {
    if (!value.recoveryPending) throw new Error('No interrupted recovery accounting is pending');
    if (!Number.isFinite(value.activeTime + elapsed)) throw new Error('Recovery debit exceeds finite accounting range');
    return { ...value, activeTime: value.activeTime + elapsed, recoveryPending: false, cleanPauseEvidence: undefined, recoveryDebitEvidence: { elapsed, evidence } };
  });
  return state.readTraversal();
}
export function cancelDurableDiscovery(state: DurableState): TraversalState {
  state.transitionTraversal(cancelTraversal);
  return state.readTraversal();
}
