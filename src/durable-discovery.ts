import type { DurableState } from './durable-state.js';
import { admitNextCell, applyDiscoveryResult, dispatchSubmission, markUncertain, observeKnownId, reserveSubmission, type DiscoveryResult, type TraversalState } from './traversal.js';

export type SyntheticSend = (workId: string) => { id: string };
export type SyntheticObserve = (id: string) => { result: DiscoveryResult; elapsed: number };
export type DurableDiscoveryBoundary = 'dequeued' | 'reserved' | 'dispatched' | 'sent' | 'id-persisted' | 'observed' | 'committed';
let boundaryHook: ((boundary: DurableDiscoveryBoundary) => void) | undefined;
/** Test-only crash injection seam; unset during normal crawler execution. */
export function setDurableDiscoveryBoundaryHookForTest(hook: ((boundary: DurableDiscoveryBoundary) => void) | undefined): void { boundaryHook = hook; }

/** Reserve before send; known IDs are re-observed on restart without another submission. */
export function executeDurableDiscovery(state: DurableState, send: SyntheticSend, observe: SyntheticObserve, uncertaintyScope: 'isolated' | 'global' = 'isolated'): TraversalState {
  let current = state.readTraversal();
  let running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')?.[0];
  if (!running) {
    state.transitionTraversal(value => admitNextCell(value));
    boundaryHook?.('dequeued');
    current = state.readTraversal();
    state.transitionTraversal(value => reserveSubmission(value, running ?? Object.keys(value.cells).find(key => value.cells[key].outcome === 'running')!));
    boundaryHook?.('reserved');
    current = state.readTraversal();
    running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')![0];
  }
  let attempt = current.attempts.findLast(item => item.cellKey === running && ['reserved', 'dispatched', 'observed'].includes(item.status));
  if (!attempt) throw new Error('Running cell has no recoverable attempt');
  if (attempt.status === 'reserved') {
    state.transitionTraversal(value => dispatchSubmission(value, running!));
    boundaryHook?.('dispatched');
    attempt = state.readTraversal().attempts.findLast(item => item.cellKey === running)!;
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
  const response = observe(id);
  boundaryHook?.('observed');
  state.transitionTraversal(value => applyDiscoveryResult(observeKnownId(value, running!, id, response.elapsed), running!, response.result));
  boundaryHook?.('committed');
  return state.readTraversal();
}
