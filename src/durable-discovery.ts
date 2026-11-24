import type { DurableState } from './durable-state.js';
import { admitNextCell, applyDiscoveryResult, dispatchSubmission, markUncertain, observeKnownId, reserveSubmission, type DiscoveryResult, type TraversalState } from './traversal.js';

export type SyntheticSend = (workId: string) => { id: string };
export type SyntheticObserve = (id: string) => { result: DiscoveryResult; elapsed: number };
export type DurableDiscoveryBoundary = 'dequeued' | 'reserved' | 'dispatched' | 'sent' | 'id-persisted' | 'observing' | 'observed' | 'committed';
let boundaryHook: ((boundary: DurableDiscoveryBoundary) => void) | undefined;
/** Test-only crash injection seam; unset during normal crawler execution. */
export function setDurableDiscoveryBoundaryHookForTest(hook: ((boundary: DurableDiscoveryBoundary) => void) | undefined): void { boundaryHook = hook; }

/** Reserve before send; known IDs are re-observed on restart without another submission. */
export function executeDurableDiscovery(state: DurableState, send: SyntheticSend, observe: SyntheticObserve, uncertaintyScope: 'isolated' | 'global' = 'global'): TraversalState {
  let current = state.readTraversal();
  if (current.paused || current.cancelled) throw new Error(current.paused ? 'Traversal is paused' : 'Traversal is cancelled');
  let running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')?.[0];
  const recoverable = current.attempts.findLast(item => item.status === 'uncertain' && item.knownId)
    ?? current.attempts.findLast(item => ['dispatched', 'observing'].includes(item.status) && item.knownId);
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
  const freshlyReserved = attempt.status === 'reserved' && reservedThisInvocation;
  if (attempt.status === 'reserved' && !reservedThisInvocation) {
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
    let response: { id: string };
    try { response = send(attempt.workId); }
    catch (error) {
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
    state.transitionTraversal(value => markUncertain(value, running!, uncertaintyScope, id));
    throw error;
  }
  boundaryHook?.('observed');
  state.transitionTraversal(value => applyDiscoveryResult(observeKnownId(value, running!, id, response.elapsed), running!, response.result));
  boundaryHook?.('committed');
  return state.readTraversal();
}
