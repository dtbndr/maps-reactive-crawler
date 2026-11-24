import type { DurableState } from './durable-state.js';
import { admitNextCell, applyDiscoveryResult, dispatchSubmission, observeKnownId, reserveSubmission, type DiscoveryResult, type TraversalState } from './traversal.js';

export type SyntheticSend = (workId: string) => { id: string };
export type SyntheticObserve = (id: string) => { result: DiscoveryResult; elapsed: number };

/** Reserve before send; known IDs are re-observed on restart without another submission. */
export function executeDurableDiscovery(state: DurableState, send: SyntheticSend, observe: SyntheticObserve): TraversalState {
  let current = state.readTraversal();
  let running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')?.[0];
  if (!running) {
    state.transitionTraversal(value => reserveSubmission(admitNextCell(value), value.queue[0]));
    current = state.readTraversal();
    running = Object.entries(current.cells).find(([, cell]) => cell.outcome === 'running')![0];
  }
  let attempt = current.attempts.findLast(item => item.cellKey === running && ['reserved', 'dispatched', 'observed'].includes(item.status));
  if (!attempt) throw new Error('Running cell has no recoverable attempt');
  if (attempt.status === 'reserved') {
    state.transitionTraversal(value => dispatchSubmission(value, running!));
    attempt = state.readTraversal().attempts.findLast(item => item.cellKey === running)!;
  }
  if (!attempt.knownId) {
    const response = send(attempt.workId);
    if (!response.id) throw new Error('Synthetic send returned no durable ID');
    state.transitionTraversal(value => ({ ...value, attempts: value.attempts.map(item => item.id === attempt!.id ? { ...item, knownId: response.id } : item) }));
  }
  const id = state.readTraversal().attempts.find(item => item.id === attempt!.id)!.knownId!;
  const response = observe(id);
  state.transitionTraversal(value => applyDiscoveryResult(observeKnownId(value, running!, id, response.elapsed), running!, response.result));
  return state.readTraversal();
}
