import type { DurableState } from './durable-state.js';
import { admitNextCell, applyDiscoveryResult, dispatchSubmission, observeKnownId, reserveSubmission, type DiscoveryResult, type TraversalState } from './traversal.js';

export type SyntheticSend = (workId: string) => { id: string; result: DiscoveryResult; elapsed: number };

/** Execute one admitted fixture discovery; reservation is committed before invoking the sender. */
export function executeDurableDiscovery(state: DurableState, send: SyntheticSend): TraversalState {
  state.transitionTraversal(current => reserveSubmission(admitNextCell(current), current.queue[0]));
  const reserved = state.readTraversal();
  const attempt = reserved.attempts.at(-1)!;
  state.transitionTraversal(current => dispatchSubmission(current, attempt.cellKey));
  const response = send(attempt.workId);
  if (!response.id) throw new Error('Synthetic send returned no durable ID');
  state.transitionTraversal(current => observeKnownId(current, attempt.cellKey, response.id, response.elapsed));
  state.transitionTraversal(current => applyDiscoveryResult(current, attempt.cellKey, response.result));
  return state.readTraversal();
}
