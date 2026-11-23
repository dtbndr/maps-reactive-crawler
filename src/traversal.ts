import { classifyCandidate, cellKey, isCellEligible, neighbors, type CandidateClass, type Geometry } from './index.js';

export type CellOutcome = 'queued' | 'running' | 'nonempty' | 'empty' | 'failed' | 'unrecognized';
export type CandidateObservation = { id: string; coordinate?: { latitude: number; longitude: number } | null; classification: CandidateClass; sourceCell: string };
export type TraversalState = { geometry: Geometry; queue: string[]; admitted: string[]; cells: Record<string, { outcome: CellOutcome }>; candidates: CandidateObservation[]; gaps: { cellKey: string; cause: 'failed' | 'unrecognized'; scope?: 'isolated' | 'global' }[]; paused: boolean };
export type DiscoveryResult = { status: 'success'; candidates: { id: string; coordinate?: { latitude: number; longitude: number } | null }[] } | { status: 'empty' } | { status: 'failed'; cause?: string; scope: 'isolated' | 'global' } | { status: 'unrecognized' };

export function createTraversal(geometry: Geometry): TraversalState {
  const key = cellKey(0, 0);
  return { geometry, queue: [key], admitted: [key], cells: { [key]: { outcome: 'queued' } }, candidates: [], gaps: [], paused: false };
}

export function admitNextCell(state: TraversalState): TraversalState {
  if (state.paused) throw new Error('Traversal is paused');
  if (Object.values(state.cells).some(cell => cell.outcome === 'running')) throw new Error('A cell is already running');
  if (state.queue.length === 0) throw new Error('No queued cell to admit');
  const [key, ...queue] = state.queue;
  return { ...state, queue, cells: { ...state.cells, [key]: { outcome: 'running' } } };
}

export function applyDiscoveryResult(state: TraversalState, key: string, result: DiscoveryResult): TraversalState {
  if (!state.admitted.includes(key) || state.cells[key]?.outcome !== 'running') throw new Error('Cell is not awaiting a result');
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
