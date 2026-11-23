import { classifyCandidate, cellKey, isCellEligible, neighbors, type CandidateClass, type Geometry } from './index.js';

export type CellOutcome = 'queued' | 'running' | 'nonempty' | 'empty' | 'failed' | 'unrecognized';
export type CandidateObservation = { id: string; coordinate?: { latitude: number; longitude: number } | null; classification: CandidateClass; sourceCell: string };
export type TraversalLimits = { cells: number; submissions: number; activeTime: number };
export type Attempt = { cellKey: string; status: 'reserved' | 'dispatched' | 'uncertain' | 'observing' | 'observed' | 'skipped'; knownId?: string };
export type TraversalReport = { outcome: 'complete' | 'partial_empty_success' | 'partial_failed' | 'partial_unrecognized' | 'partial_limit' | 'partial_cancelled' | 'partial_gaps'; queue: string[]; blocked: string[]; gaps: TraversalState['gaps']; submissions: number; activeTime: number; cells: TraversalState['cells'] };
export type TraversalState = { geometry: Geometry; limits: TraversalLimits; queue: string[]; admitted: string[]; cells: Record<string, { outcome: CellOutcome }>; candidates: CandidateObservation[]; gaps: { cellKey: string; cause: 'failed' | 'unrecognized' | 'uncertain'; scope?: 'isolated' | 'global' }[]; paused: boolean; submissions: number; activeTime: number; blocked: string[]; attempts: Attempt[]; cancelled: boolean };
export type DiscoveryResult = { status: 'success'; candidates: { id: string; coordinate?: { latitude: number; longitude: number } | null }[] } | { status: 'empty' } | { status: 'failed'; cause?: string; scope: 'isolated' | 'global' } | { status: 'unrecognized' };

export function createTraversal(geometry: Geometry, limits: TraversalLimits): TraversalState {
  if (!limits || ![limits.cells, limits.submissions, limits.activeTime].every(Number.isFinite) || limits.cells < 1 || limits.submissions < 0 || limits.activeTime < 0) throw new Error('Invalid finite traversal limits');
  const key = cellKey(0, 0);
  return { geometry, limits, queue: [key], admitted: [key], cells: { [key]: { outcome: 'queued' } }, candidates: [], gaps: [], paused: false, submissions: 0, activeTime: 0, blocked: [], attempts: [], cancelled: false };
}

export function reserveSubmission(state: TraversalState, key: string): TraversalState {
  if (state.paused || state.cancelled || state.activeTime >= state.limits.activeTime) throw new Error('Submission stopped');
  if (state.cells[key]?.outcome !== 'running') throw new Error('Cell is not running');
  if (state.submissions >= state.limits.submissions) throw new Error('Submission limit reached');
  if (state.attempts.some(a => a.cellKey === key && ['reserved','dispatched','uncertain','observing','skipped'].includes(a.status))) throw new Error('Attempt outstanding');
  return { ...state, submissions: state.submissions + 1, attempts: [...state.attempts, { cellKey: key, status: 'reserved' }] };
}
export function dispatchSubmission(state: TraversalState, key: string): TraversalState {
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || state.attempts[i].status !== 'reserved') throw new Error('Attempt is not reserved');
  const attempts = [...state.attempts]; attempts[i] = { ...attempts[i], status: 'dispatched' }; return { ...state, attempts };
}
export function admitNextCell(state: TraversalState): TraversalState {
  if (state.cancelled) throw new Error('Traversal is cancelled');
  if (state.paused) throw new Error('Traversal is paused');
  if (state.activeTime >= state.limits.activeTime) throw new Error('Active-time limit reached');
  if (Object.values(state.cells).some(cell => cell.outcome === 'running')) throw new Error('A cell is already running');
  if (state.queue.length === 0) throw new Error('No queued cell to admit');
  const [key, ...queue] = state.queue;
  return { ...state, queue, cells: { ...state.cells, [key]: { outcome: 'running' } } };
}

export function skipAttempt(state: TraversalState, key: string): TraversalState {
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || state.attempts[i].status !== 'uncertain') throw new Error('Attempt is not uncertain');
  const attempts = [...state.attempts]; attempts[i] = { ...attempts[i], status: 'skipped' };
  return { ...state, attempts };
}
export function authorizeResend(state: TraversalState, key: string): TraversalState {
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || state.attempts[i].status !== 'uncertain') throw new Error('Attempt is not uncertain');
  if (state.submissions >= state.limits.submissions || state.activeTime >= state.limits.activeTime || state.cancelled || state.paused) throw new Error('Resend limit reached');
  return { ...state, submissions: state.submissions + 1, attempts: [...state.attempts, { cellKey: key, status: 'reserved' }] };
}
export function observeKnownId(state: TraversalState, key: string, id: string, elapsed: number): TraversalState {
  if (!id || !Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid observation');
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || !['dispatched', 'uncertain'].includes(state.attempts[i].status)) throw new Error('No known submission to observe');
  const attempts = [...state.attempts]; attempts[i] = { ...attempts[i], status: 'observed', knownId: id };
  return { ...state, attempts, activeTime: state.activeTime + elapsed };
}
export function pauseTraversal(state: TraversalState): TraversalState {
  if (state.cancelled) throw new Error('Traversal is cancelled');
  return { ...state, paused: true };
}
export function resumeTraversal(state: TraversalState): TraversalState {
  if (state.cancelled) throw new Error('Traversal is cancelled');
  return { ...state, paused: false };
}
export function updateTraversalLimits(state: TraversalState, limits: TraversalLimits): TraversalState {
  if (!limits || ![limits.cells, limits.submissions, limits.activeTime].every(Number.isFinite) || limits.cells < 1 || limits.submissions < 0 || limits.activeTime < 0) throw new Error('Invalid finite traversal limits');
  return { ...state, limits: { ...limits } };
}
export function cancelTraversal(state: TraversalState): TraversalState { return { ...state, cancelled: true }; }
export function reportTraversal(state: TraversalState): TraversalReport {
  let outcome: TraversalReport['outcome'];
  if (state.cancelled) outcome = 'partial_cancelled';
  else if (state.activeTime >= state.limits.activeTime || state.submissions >= state.limits.submissions || state.blocked.length) outcome = 'partial_limit';
  else if (state.gaps.length) outcome = state.queue.length ? 'partial_failed' : 'partial_gaps';
  else if (Object.values(state.cells).some(c => c.outcome === 'failed')) outcome = 'partial_failed';
  else if (Object.values(state.cells).some(c => c.outcome === 'unrecognized')) outcome = 'partial_unrecognized';
  else if (Object.values(state.cells).some(c => c.outcome === 'empty')) outcome = 'partial_empty_success';
  else outcome = 'complete';
  return { outcome, queue: [...state.queue], blocked: [...state.blocked], gaps: [...state.gaps], submissions: state.submissions, activeTime: state.activeTime, cells: { ...state.cells } };
}
export function debitActiveTime(state: TraversalState, elapsed: number): TraversalState {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid elapsed time');
  return { ...state, activeTime: state.activeTime + elapsed };
}
export function markUncertain(state: TraversalState, key: string): TraversalState {
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || state.attempts[i].status !== 'dispatched') throw new Error('Attempt is not dispatched');
  const attempts = [...state.attempts]; attempts[i] = { ...attempts[i], status: 'uncertain' };
  return { ...state, attempts, gaps: [...state.gaps, { cellKey: key, cause: 'uncertain' }] };
}
export function applyDiscoveryResult(state: TraversalState, key: string, result: DiscoveryResult): TraversalState {
  if (!state.admitted.includes(key) || state.cells[key]?.outcome !== 'running') throw new Error('Cell is not awaiting a result');
  if (state.attempts.at(-1)?.cellKey !== key || !['dispatched', 'observed'].includes(state.attempts.at(-1)?.status ?? '')) throw new Error('Result requires dispatched attempt');
  const cells = { ...state.cells };
  const candidates = [...state.candidates];
  const gaps = [...state.gaps];
  const queue = [...state.queue];
  const admitted = [...state.admitted];
  let paused = state.paused;
  if (result.status === 'success' && result.candidates.length > 0) {
    cells[key] = { outcome: 'nonempty' };
    for (const candidate of result.candidates) candidates.push({ ...candidate, classification: classifyCandidate(state.geometry, candidate.coordinate), sourceCell: key });
    const [column, row] = key.split(',').map(Number);
    for (const [c, r] of neighbors(state.geometry, column, row)) {
      const nextKey = cellKey(c, r);
      if (isCellEligible(state.geometry, c, r) && !admitted.includes(nextKey)) {
        if (admitted.length >= state.limits.cells) { if (!state.blocked.includes(nextKey)) state.blocked.push(nextKey); continue; }
        admitted.push(nextKey);
        cells[nextKey] = { outcome: 'queued' };
        queue.push(nextKey);
      }
    }
  } else if (result.status === 'success' || result.status === 'empty') cells[key] = { outcome: 'empty' };
  else if (result.status === 'failed') { cells[key] = { outcome: 'failed' }; gaps.push({ cellKey: key, cause: 'failed', scope: result.scope }); if (result.scope === 'global') paused = true; }
  else { cells[key] = { outcome: 'unrecognized' }; gaps.push({ cellKey: key, cause: 'unrecognized' }); }
  return { ...state, queue, admitted, cells, candidates, gaps, paused };
}
