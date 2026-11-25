import { classifyCandidate, cellKey, isCellEligible, neighbors, type CandidateClass, type Geometry } from './index.js';

export type CellOutcome = 'queued' | 'running' | 'parked' | 'nonempty' | 'empty' | 'failed' | 'unrecognized';
export type CandidateObservation = { id: string; coordinate?: { latitude: number; longitude: number } | null; classification: CandidateClass; sourceCell: string; observationId: string; attemptId: string; occurrence: number; verifiedCanonicalKey?: string };
export type TraversalLimits = { cells: number; submissions: number; activeTime: number };
export type Attempt = { id: string; workId: string; cellKey: string; status: 'reserved' | 'dispatched' | 'uncertain' | 'observing' | 'observed' | 'skipped' | 'confirmed_no_send'; knownId?: string; retryOrdinal?: number; observationRetryCeiling?: number; retryCeiling?: number; submissionRetryOrdinal?: number; submissionRetryCeiling?: number; resendOrdinal?: number; resendCeiling?: number; approval?: { rationale: string }; recoveryEvidence?: { source: string; evidence: string; timestamp: string }; safeRetryAuthorization?: { ordinal: number; ceiling: number; delayMs?: number }; observationRetryPendingDelayMs?: number };
export type TraversalReport = { stopReason: 'cancelled' | 'paused' | 'active_time' | 'submissions' | 'cells' | 'gaps' | 'failed' | 'unrecognized' | 'empty' | 'in_progress' | 'complete'; outcome: 'complete' | 'in_progress' | 'partial_empty_success' | 'partial_failed' | 'partial_unrecognized' | 'partial_limit' | 'partial_cancelled' | 'partial_gaps'; queue: string[]; blocked: string[]; gaps: TraversalState['gaps']; submissions: number; activeTime: number; cells: TraversalState['cells'] };
export type DetailAttempt = { id: string; status: 'reserved' | 'dispatched' | 'uncertain' | 'completed' | 'skipped'; knownId?: string; observationRetryOrdinal?: number; observationRetryCeiling?: number; observationRetryPendingDelayMs?: number; observationRetryDisposition?: 'initial' | 'authorized' | 'closed' };
export type DetailWork = { id: string; status: 'pending' | 'reserved' | 'dispatched' | 'uncertain' | 'completed' | 'skipped'; identity: string; observationIds: string[]; attempts: DetailAttempt[] };
export type DetailGap = { workId: string; identity: string; observationIds: string[]; status: 'unresolved' | 'resolved' | 'skipped' };
export type TraversalState = { detailWork?: DetailWork[]; detailGaps?: DetailGap[]; detailOriginBlockers?: { workId: string; gapId: string; cellKey: string; status: 'unresolved' | 'resolved' }[]; timeUnit: 'milliseconds'; geometry: Geometry; limits: TraversalLimits; queue: string[]; admitted: string[]; cells: Record<string, { outcome: CellOutcome }>; candidates: CandidateObservation[]; gaps: { cellKey: string; cause: 'failed' | 'unrecognized' | 'uncertain'; scope?: 'isolated' | 'global'; status?: 'unresolved' | 'resolved' | 'skipped'; id?: string }[]; paused: boolean; submissions: number; activeTime: number; blocked: string[]; attempts: Attempt[]; cancelled: boolean; activeInterval?: boolean; recoveryPending?: boolean; cleanPauseEvidence?: { evidence: string }; recoveryDebitEvidence?: { elapsed: number; evidence: string }; resendCeiling?: number; resendApprovalsConsumed?: number };
export type DiscoveryResult = { status: 'success'; candidates: { id: string; coordinate?: { latitude: number; longitude: number } | null; verifiedCanonicalKey?: string }[] } | { status: 'empty' } | { status: 'failed'; cause?: string; scope: 'isolated' | 'global' } | { status: 'unrecognized' };

export function createTraversal(geometry: Geometry, limits: TraversalLimits): TraversalState {
  if (!limits || ![limits.cells, limits.submissions, limits.activeTime].every(Number.isFinite) || !Number.isSafeInteger(limits.cells) || !Number.isSafeInteger(limits.submissions) || limits.cells < 1 || limits.submissions < 0 || limits.activeTime < 0) throw new Error('Invalid finite traversal limits');
  const key = cellKey(0, 0);
  return { timeUnit: 'milliseconds', geometry, limits, queue: [key], admitted: [key], cells: { [key]: { outcome: 'queued' } }, candidates: [], gaps: [], paused: false, submissions: 0, activeTime: 0, blocked: [], attempts: [], cancelled: false, recoveryPending: false };
}

export function authorizeSafeRetryReservation(state: TraversalState, key: string, retryOrdinal: number, ceiling: number): TraversalState {
  const previous = state.attempts.findLast(a => a.cellKey === key);
  if (!previous || previous.status !== 'uncertain' || !Number.isInteger(retryOrdinal) || retryOrdinal < 1 || retryOrdinal > ceiling || state.submissions >= state.limits.submissions || state.activeTime >= state.limits.activeTime || state.paused || state.cancelled) throw new Error('Safe retry cannot be reserved');
  if (previous.safeRetryAuthorization?.ordinal !== retryOrdinal || previous.safeRetryAuthorization.ceiling !== ceiling) throw new Error('Safe retry authorization missing');
  const ordinal = state.attempts.filter(a => a.cellKey === key).length + 1;
  return { ...state, submissions: state.submissions + 1, attempts: [...state.attempts, { id: `${previous.workId}:attempt:${ordinal}`, workId: previous.workId, cellKey: key, status: 'reserved', submissionRetryOrdinal: retryOrdinal, submissionRetryCeiling: ceiling }] };
}
export function authorizeSafeRetry(state: TraversalState, key: string, retryOrdinal: number, ceiling: number, delayMs = 0): TraversalState {
  const previous = state.attempts.findLast(a => a.cellKey === key);
  if (!previous || previous.status !== 'uncertain' || !Number.isInteger(retryOrdinal) || retryOrdinal < 1 || retryOrdinal > ceiling || !Number.isSafeInteger(delayMs) || delayMs < 0 || state.paused || state.cancelled) throw new Error('Safe retry cannot be authorized');
  const attempts = [...state.attempts]; attempts[attempts.indexOf(previous)] = { ...previous, safeRetryAuthorization: { ordinal: retryOrdinal, ceiling, delayMs } };
  return { ...state, attempts };
}
export function reserveDetailSubmission(state: TraversalState, workId: string): TraversalState {
  if (state.recoveryPending || state.paused || state.cancelled || state.activeTime >= state.limits.activeTime) throw new Error('Detail submission stopped');
  if (state.submissions >= state.limits.submissions) throw new Error('Submission limit reached');
  const work = state.detailWork?.find(item => item.id === workId);
  if (!work || work.status !== 'pending' || work.attempts.length !== 0) throw new Error('Detail work is not pending');
  if (state.detailWork!.filter(item => item.id === workId).length !== 1) throw new Error('Duplicate detail work ID');
  const ordinal = work.attempts.length + 1;
  const detailWork = state.detailWork!.map(item => item.id === workId ? { ...item, status: 'reserved' as const, attempts: [...item.attempts, { id: `${workId}:attempt:${ordinal}`, status: 'reserved' as const }] } : item);
  return { ...state, submissions: state.submissions + 1, detailWork };
}
export function recordDetailId(state: TraversalState, workId: string, id: string): TraversalState {
  if (!id) throw new Error('Detail ID is required');
  const work = state.detailWork?.find(item => item.id === workId);
  if (!work || work.status !== 'dispatched' || work.attempts.at(-1)?.status !== 'dispatched') throw new Error('Detail attempt is not dispatched');
  return { ...state, detailWork: state.detailWork!.map(item => item.id === workId ? { ...item, attempts: item.attempts.map((attempt, index) => index === item.attempts.length - 1 ? { ...attempt, knownId: id } : attempt) } : item) };
}
export function markDetailUncertain(state: TraversalState, workId: string): TraversalState {
  const work = state.detailWork?.find(item => item.id === workId);
  if (!work || !['reserved', 'dispatched', 'uncertain'].includes(work.status)) throw new Error('Detail work cannot become uncertain');
  const detailWork = state.detailWork!.map(item => item.id === workId ? { ...item, status: 'uncertain' as const, attempts: item.attempts.map((attempt, index) => index === item.attempts.length - 1 ? { ...attempt, status: 'uncertain' as const } : attempt) } : item);
  const gaps = state.detailGaps ?? [];
  const existing = gaps.some(gap => gap.workId === workId && gap.status === 'unresolved');
  const globalGap = work.observationIds.map(id => state.candidates.find(candidate => candidate.observationId === id)?.sourceCell).find((key): key is string => Boolean(key));
  const origin = state.detailOriginBlockers?.find(blocker => blocker.workId === workId);
  const gapId = origin?.gapId ?? `detail-origin:${workId}`;
  const traversalGaps = globalGap && !origin
    ? [...state.gaps, { id: gapId, cellKey: globalGap, cause: 'uncertain' as const, scope: 'global' as const, status: 'unresolved' as const }]
    : state.gaps;
  const detailOriginBlockers = globalGap && !origin ? [...(state.detailOriginBlockers ?? []), { workId, gapId, cellKey: globalGap, status: 'unresolved' as const }] : state.detailOriginBlockers ?? [];
  return { ...state, detailOriginBlockers, gaps: traversalGaps, detailWork, detailGaps: existing ? gaps : [...gaps, { workId, identity: work.identity, observationIds: [...work.observationIds], status: 'unresolved' }] };
}
export function authorizeDetailObservationRetry(state: TraversalState, workId: string, ceiling: number, delayMs: number): TraversalState {
  if (!Number.isSafeInteger(ceiling) || ceiling < 0 || !Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error('Invalid finite detail retry policy');
  const work = state.detailWork?.find(item => item.id === workId), attempt = work?.attempts.at(-1);
  if (!work || !attempt?.knownId || !['dispatched', 'uncertain'].includes(attempt.status)) throw new Error('No known detail ID to retry observation');
  if (attempt.observationRetryCeiling !== undefined && attempt.observationRetryCeiling !== ceiling) throw new Error('Detail retry ceiling is immutable');
  const ordinal = (attempt.observationRetryOrdinal ?? 0) + 1;
  if (ordinal > (attempt.observationRetryCeiling ?? ceiling)) throw new Error('Detail observation retry ceiling exhausted');
  const detailWork = state.detailWork!.map(item => item.id === workId ? { ...item, status: 'uncertain' as const, attempts: item.attempts.map((value, index) => index === item.attempts.length - 1 ? { ...value, status: 'uncertain' as const, observationRetryOrdinal: ordinal, observationRetryCeiling: attempt.observationRetryCeiling ?? ceiling, observationRetryPendingDelayMs: delayMs, observationRetryDisposition: 'authorized' as const } : value) } : item);
  return { ...state, detailWork };
}
export function completeDetailWork(state: TraversalState, workId: string, id: string): TraversalState {
  if (state.cancelled || state.paused) throw new Error('Detail completion stopped');
  const work = state.detailWork?.find(item => item.id === workId);
  if (!work || !['dispatched', 'uncertain'].includes(work.status) || work.attempts.at(-1)?.knownId !== id) throw new Error('Detail result does not match durable ID');
  const detailWork = state.detailWork!.map(item => item.id === workId ? { ...item, status: 'completed' as const, attempts: item.attempts.map((attempt, index) => index === item.attempts.length - 1 ? { ...attempt, status: 'completed' as const, observationRetryPendingDelayMs: undefined } : attempt) } : item);
  const detailGaps = state.detailGaps ?? [];
  const matching = detailGaps.filter(gap => gap.identity === work.identity && gap.status === 'unresolved');
  const reconciled = work.identity.startsWith('verified:') && work.identity.length > 'verified:'.length && work.observationIds.every(observationId => state.candidates.some(candidate => candidate.observationId === observationId && candidate.verifiedCanonicalKey === work.identity.slice('verified:'.length)));
  const detailOriginBlockers = reconciled ? (state.detailOriginBlockers ?? []).map(blocker => blocker.workId === workId && blocker.status === 'unresolved' ? { ...blocker, status: 'resolved' as const } : blocker) : state.detailOriginBlockers;
  const originBlocker = reconciled ? state.detailOriginBlockers?.find(blocker => blocker.workId === workId && blocker.status === 'unresolved') : undefined;
  const gaps = originBlocker ? state.gaps.map(gap => gap.id === originBlocker.gapId ? { ...gap, status: 'resolved' as const } : gap) : state.gaps;
  return { ...state, gaps, detailOriginBlockers, detailWork, detailGaps: detailGaps.map(gap => matching.includes(gap) && reconciled ? { ...gap, status: 'resolved' as const } : gap) };
}
export function dispatchDetailSubmission(state: TraversalState, workId: string): TraversalState {
  if (state.recoveryPending) throw new Error('Recovery accounting is unresolved');
  if (state.cancelled || state.paused || state.activeTime >= state.limits.activeTime) throw new Error('Detail dispatch stopped');
  if (state.submissions > state.limits.submissions) throw new Error('Submission limit prevents dispatch');
  const work = state.detailWork?.find(item => item.id === workId);
  if (!work || work.status !== 'reserved') throw new Error('Detail work is not reserved');
  if (state.detailWork!.filter(item => item.id === workId).length !== 1) throw new Error('Duplicate detail work ID');
  const attempt = work.attempts.at(-1);
  if (!attempt || attempt.id !== `${work.id}:attempt:${work.attempts.length}` || attempt.status !== 'reserved') throw new Error('Detail work has no valid reserved attempt');
  const detailWork = state.detailWork!.map(item => item.id === workId ? { ...item, status: 'dispatched' as const, attempts: item.attempts.map((attempt, i) => i === item.attempts.length - 1 ? { ...attempt, status: 'dispatched' as const } : attempt) } : item);
  return { ...state, detailWork };
}
export function reserveSubmission(state: TraversalState, key: string): TraversalState {
  if (state.recoveryPending) throw new Error('Recovery accounting is unresolved');
  if (state.paused || state.cancelled || state.activeTime >= state.limits.activeTime) throw new Error('Submission stopped');
  if (state.submissions >= state.limits.submissions) throw new Error('Submission limit reached');
  if (state.attempts.some(a => a.cellKey === key && ['reserved','dispatched','uncertain','observing','observed','skipped'].includes(a.status))) throw new Error('Attempt outstanding');
  if (state.cells[key]?.outcome !== 'running') throw new Error('Cell is not running');
  const ordinal = state.attempts.filter(a => a.cellKey === key).length + 1;
  const workId = `work:${key}`;
  return { ...state, submissions: state.submissions + 1, attempts: [...state.attempts, { id: `${workId}:attempt:${ordinal}`, workId, cellKey: key, status: 'reserved', submissionRetryOrdinal: 0 }] };
}
export function confirmNoSend(state: TraversalState, key: string): TraversalState {
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || !['reserved', 'dispatched'].includes(state.attempts[i].status)) throw new Error('Attempt cannot be confirmed unsent');
  const attempts = [...state.attempts]; attempts[i] = { ...attempts[i], status: 'confirmed_no_send' };
  return { ...state, attempts, cells: { ...state.cells, [key]: { outcome: 'failed' } }, gaps: [...state.gaps, { cellKey: key, cause: 'failed', scope: 'isolated', status: 'unresolved' }] };
}
export function dispatchSubmission(state: TraversalState, key: string): TraversalState {
  if (state.recoveryPending) throw new Error('Recovery accounting is unresolved');
  if (state.cancelled || state.paused || state.activeTime >= state.limits.activeTime) throw new Error('Dispatch stopped');
  if (state.submissions > state.limits.submissions) throw new Error('Submission limit prevents dispatch');
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || state.attempts[i].status !== 'reserved') throw new Error('Attempt is not reserved');
  const attempts = [...state.attempts]; attempts[i] = { ...attempts[i], status: 'dispatched' }; return { ...state, attempts };
}
export function admitNextCell(state: TraversalState): TraversalState {
  if (state.recoveryPending) throw new Error('Recovery accounting is unresolved');
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
  const gaps = state.gaps.map(g => g.cellKey === key && g.cause === 'uncertain' ? { ...g, status: 'skipped' as const } : g);
  const cells = { ...state.cells, [key]: { outcome: 'failed' as const } };
  return { ...state, attempts, cells, gaps };
}
export function authorizeResend(state: TraversalState, key: string, rationale = 'operator-approved', ceiling = 1): TraversalState {
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || state.attempts[i].status !== 'uncertain') throw new Error('Attempt is not uncertain');
  if (state.attempts[i].knownId) throw new Error('Known ID must be observed, not resubmitted');
  if (!rationale.trim()) throw new Error('Resend rationale is required');
  if (!Number.isSafeInteger(ceiling) || ceiling < 1) throw new Error('Invalid resend ceiling');
  if (state.resendCeiling !== undefined && state.resendCeiling !== ceiling) throw new Error('Resend ceiling is immutable');
  const ordinal = (state.resendApprovalsConsumed ?? 0) + 1;
  if (ordinal > ceiling) throw new Error('Resend ceiling exhausted');
  if (state.submissions >= state.limits.submissions || state.activeTime >= state.limits.activeTime || state.cancelled || state.paused) throw new Error('Resend limit reached');
  const attemptNumber = state.attempts.filter(a => a.cellKey === key).length + 1;
  const workId = `work:${key}`;
  return { ...state, resendCeiling: ceiling, resendApprovalsConsumed: ordinal, submissions: state.submissions + 1, cells: { ...state.cells, [key]: { outcome: 'running' } }, attempts: [...state.attempts, { id: `${workId}:attempt:${attemptNumber}`, workId, cellKey: key, status: 'reserved', resendOrdinal: ordinal, resendCeiling: ceiling, approval: { rationale } }] };
}
export function recoverKnownId(state: TraversalState, key: string, id: string, evidence: { source: string; evidence: string; timestamp: string }): TraversalState {
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  const attempt = state.attempts[i];
  if (!attempt || attempt.status !== 'uncertain' || attempt.knownId || !id || !evidence.source || !evidence.evidence || !Number.isFinite(Date.parse(evidence.timestamp))) throw new Error('Invalid recovered ID evidence');
  const attempts = [...state.attempts]; attempts[i] = { ...attempt, knownId: id, recoveryEvidence: { ...evidence } };
  return { ...state, attempts };
}
export function retryKnownIdObservation(state: TraversalState, key: string, ceiling: number): TraversalState {
  if (!Number.isInteger(ceiling) || ceiling < 0) throw new Error('Invalid finite retry ceiling');
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  const attempt = state.attempts[i];
  if (!attempt?.knownId || !['dispatched', 'observing', 'uncertain'].includes(attempt.status)) throw new Error('No known ID to retry observation');
  const ordinal = (attempt.retryOrdinal ?? 0) + 1;
  const effectiveCeiling = attempt.observationRetryCeiling ?? (attempt.retryOrdinal === undefined ? ceiling : 0);
  if (ordinal > effectiveCeiling) throw new Error('Observation retry ceiling exhausted');
  const attempts = [...state.attempts]; attempts[i] = { ...attempt, status: 'observing', retryOrdinal: ordinal, observationRetryCeiling: effectiveCeiling };
  return { ...state, attempts };
}
export function observeKnownId(state: TraversalState, key: string, id: string, elapsed: number): TraversalState {
  if (!id || !Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid observation');
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || !['dispatched', 'uncertain', 'observing'].includes(state.attempts[i].status)) throw new Error('No known submission to observe');
  const attempts = [...state.attempts]; attempts[i] = { ...attempts[i], status: 'observed', knownId: id };
  return { ...state, attempts, cells: { ...state.cells, [key]: { outcome: 'running' } }, activeTime: state.activeTime + elapsed };
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
  if (!limits || ![limits.cells, limits.submissions, limits.activeTime].every(Number.isFinite) || !Number.isSafeInteger(limits.cells) || !Number.isSafeInteger(limits.submissions) || limits.cells < 1 || limits.submissions < 0 || limits.activeTime < 0) throw new Error('Invalid finite traversal limits');
  return { ...state, limits: { ...limits } };
}
export function cancelTraversal(state: TraversalState): TraversalState { return { ...state, cancelled: true }; }
export function reportTraversal(state: TraversalState): TraversalReport {
  let outcome: TraversalReport['outcome'];
  let stopReason: TraversalReport['stopReason'];
  const running = Object.values(state.cells).some(c => c.outcome === 'running');
  const unresolvedGaps = state.gaps.filter(g => g.status !== 'resolved');
  const reserved = state.attempts.some(a => a.status === 'reserved');
  const runningKeys = new Set(Object.entries(state.cells).filter(([, cell]) => cell.outcome === 'running').map(([key]) => key));
  const hasAttempt = state.attempts.some(a => runningKeys.has(a.cellKey) && ['reserved', 'dispatched', 'uncertain', 'observing', 'observed'].includes(a.status));
  if (state.cancelled) { outcome = 'partial_cancelled'; stopReason = 'cancelled'; }
  else if (state.paused && (state.queue.length || running)) { outcome = 'partial_limit'; stopReason = 'paused'; }
  else if ((state.queue.length || state.blocked.length || reserved || (running && !hasAttempt)) && state.activeTime >= state.limits.activeTime) { outcome = 'partial_limit'; stopReason = 'active_time'; }
  else if (((state.queue.length || (running && !hasAttempt)) && state.submissions >= state.limits.submissions) || (reserved && state.submissions > state.limits.submissions)) { outcome = 'partial_limit'; stopReason = 'submissions'; }
  else if (state.blocked.length) { outcome = 'partial_limit'; stopReason = 'cells'; }
  else if (state.queue.length || running) { outcome = 'in_progress'; stopReason = 'in_progress'; }
  else if (unresolvedGaps.length) { outcome = 'partial_gaps'; stopReason = 'gaps'; }
  else if (Object.values(state.cells).some(c => c.outcome === 'failed')) { outcome = 'partial_failed'; stopReason = 'failed'; }
  else if (Object.values(state.cells).some(c => c.outcome === 'unrecognized')) { outcome = 'partial_unrecognized'; stopReason = 'unrecognized'; }
  else if (Object.values(state.cells).some(c => c.outcome === 'empty')) { outcome = 'partial_empty_success'; stopReason = 'empty'; }
  else { outcome = 'complete'; stopReason = 'complete'; }
  return { outcome, stopReason, queue: [...state.queue], blocked: [...state.blocked], gaps: unresolvedGaps.map(g => ({ ...g })), submissions: state.submissions, activeTime: state.activeTime, cells: { ...state.cells } };
}
export function debitActiveTime(state: TraversalState, elapsed: number): TraversalState {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid elapsed time');
  return { ...state, activeTime: state.activeTime + elapsed };
}
export function markUncertain(state: TraversalState, key: string, scope: 'isolated' | 'global' = 'isolated', knownId?: string): TraversalState {
  const i = state.attempts.map(a => a.cellKey).lastIndexOf(key);
  if (i < 0 || !['dispatched', 'observing'].includes(state.attempts[i].status)) throw new Error('Attempt is not dispatched');
  const attempts = [...state.attempts]; attempts[i] = { ...attempts[i], status: 'uncertain', ...(knownId ? { knownId } : {}) };
  return { ...state, attempts, cells: { ...state.cells, [key]: { outcome: 'parked' } }, paused: state.paused || scope === 'global', gaps: [...state.gaps, { cellKey: key, cause: 'uncertain', scope, status: 'unresolved' }] };
}
export function applyDiscoveryResult(state: TraversalState, key: string, result: DiscoveryResult): TraversalState {
  if (!state.admitted.includes(key) || state.cells[key]?.outcome !== 'running') throw new Error('Cell is not awaiting a result');
  const latestAttempt = state.attempts.findLast(attempt => attempt.cellKey === key);
  if (!latestAttempt || !['dispatched', 'observed'].includes(latestAttempt.status)) throw new Error('Result requires dispatched attempt');
  const cells = { ...state.cells };
  const candidates = [...state.candidates];
  // Upgrade legacy snapshots atomically when a result is applied; observations
  // without explicit verified identity remain independent work items.
  const detailWork = state.detailWork ? state.detailWork.map(work => ({ ...work, observationIds: [...work.observationIds] })) : [];
  if (state.detailWork === undefined) {
    for (const candidate of state.candidates) {
      const identity = candidate.verifiedCanonicalKey ? `verified:${candidate.verifiedCanonicalKey}` : `observation:${candidate.observationId}`;
      let work = detailWork.find(item => item.identity === identity);
      if (!work) { work = { id: `detail:${identity}`, status: 'pending', identity, observationIds: [], attempts: [] }; detailWork.push(work); }
      work.observationIds.push(candidate.observationId);
    }
  }
  const byVerifiedIdentity = new Map<string, string>();
  for (const work of detailWork) if (work.identity.startsWith('verified:')) {
    if (work.id !== `detail:${work.identity}` || byVerifiedIdentity.has(work.identity)) throw new Error('Invalid detail work identity');
    byVerifiedIdentity.set(work.identity, work.id);
  }
  const gaps = [...state.gaps];
  const queue = [...state.queue];
  const admitted = [...state.admitted];
  const blocked = [...state.blocked];
  let paused = state.paused;
  if (result.status === 'success' && result.candidates.length > 0) {
    cells[key] = { outcome: 'nonempty' };
    for (const [occurrence, candidate] of result.candidates.entries()) {
      const observationId = `${latestAttempt.id}:observation:${occurrence + 1}`;
      candidates.push({ ...candidate, classification: classifyCandidate(state.geometry, candidate.coordinate), sourceCell: key, observationId, attemptId: latestAttempt.id, occurrence: occurrence + 1 });
      const identity = candidate.verifiedCanonicalKey ? `verified:${candidate.verifiedCanonicalKey}` : `observation:${observationId}`;
      let work = detailWork.find(item => item.identity === identity);
      if (work && work.id !== `detail:${identity}`) throw new Error('Invalid detail work identity');
      if (!work) { work = { id: `detail:${identity}`, status: 'pending', identity, observationIds: [], attempts: [] }; detailWork.push(work); }
      if (!work.observationIds.includes(observationId)) work.observationIds.push(observationId);
    }
    const [column, row] = key.split(',').map(Number);
    for (const [c, r] of neighbors(state.geometry, column, row)) {
      const nextKey = cellKey(c, r);
      if (isCellEligible(state.geometry, c, r) && !admitted.includes(nextKey)) {
        if (state.cancelled || state.paused || state.activeTime >= state.limits.activeTime || admitted.length >= state.limits.cells) { if (!blocked.includes(nextKey)) blocked.push(nextKey); continue; }
        admitted.push(nextKey);
        cells[nextKey] = { outcome: 'queued' };
        queue.push(nextKey);
      }
    }
  } else if (result.status === 'success' || result.status === 'empty') cells[key] = { outcome: 'empty' };
  else if (result.status === 'failed') { cells[key] = { outcome: 'failed' }; gaps.push({ cellKey: key, cause: 'failed', scope: result.scope }); if (result.scope === 'global') paused = true; }
  else { cells[key] = { outcome: 'unrecognized' }; gaps.push({ cellKey: key, cause: 'unrecognized' }); }
  const attempts = [...state.attempts];
  const latest = attempts.map(a => a.cellKey).lastIndexOf(key);
  if ((attempts[latest]?.status === 'observed' || attempts[latest]?.status === 'dispatched') && (result.status === 'success' || result.status === 'empty')) {
    for (let index = 0; index < gaps.length; index++) {
      if (gaps[index].cellKey === key && gaps[index].cause === 'uncertain' && gaps[index].status !== 'skipped') gaps[index] = { ...gaps[index], status: 'resolved' };
    }
  }
  return { ...state, queue, admitted, cells, candidates, detailWork, gaps, blocked, paused };
}
