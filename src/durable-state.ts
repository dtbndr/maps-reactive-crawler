import { DatabaseSync } from 'node:sqlite';
import { closeSync, linkSync, lstatSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { TraversalState } from './traversal.js';
import { cellKey, isCellEligible, validateGeometry } from './index.js';
import { cancelTraversal } from './traversal.js';

type Snapshot = { version: 1; work: { id: string; status: string }[]; observations: unknown[]; gaps: unknown[] };
let afterOwnerReadForTest: (() => void) | undefined;
let beforePublishForTest: (() => void) | undefined;
let afterCreateForTest: (() => void) | undefined;
let afterTraversalWriteForTest: (() => void) | undefined;
/** Internal synchronization seam for deterministic ownership-race tests. */
export function setAfterOwnerReadForTest(hook: (() => void) | undefined): void { afterOwnerReadForTest = hook; }
/** Internal synchronization seam for deterministic interruption tests. */
export function setBeforePublishForTest(hook: (() => void) | undefined): void { beforePublishForTest = hook; }
/** Internal synchronization seam for deterministic creation-race tests. */
export function setAfterCreateForTest(hook: (() => void) | undefined): void { afterCreateForTest = hook; }
/** Test-only crash injection after the traversal UPDATE and before COMMIT. */
export function setAfterTraversalWriteForTest(hook: (() => void) | undefined): void { afterTraversalWriteForTest = hook; }
function validate(value: unknown): asserts value is Snapshot {
  if (!value || typeof value !== 'object' || (value as any).version !== 1 || !Array.isArray((value as any).work) || !(value as any).work.every((entry: any) => entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.status === 'string') || !Array.isArray((value as any).observations) || !Array.isArray((value as any).gaps)) throw new Error('Unsupported or corrupt state');
}
function validateTraversal(value: unknown): asserts value is TraversalState {
  const s = value as any;
  if (!s || typeof s !== 'object' || (s.activeInterval !== undefined && typeof s.activeInterval !== 'boolean') || (s.timeUnit !== undefined && s.timeUnit !== 'milliseconds') || typeof s.recoveryPending !== 'undefined' && typeof s.recoveryPending !== 'boolean' || !s.geometry || !s.limits || ![s.limits.cells, s.limits.submissions, s.limits.activeTime].every(Number.isFinite) || !Number.isSafeInteger(s.limits.cells) || !Number.isSafeInteger(s.limits.submissions) || !Number.isSafeInteger(s.limits.cells) || !Number.isSafeInteger(s.limits.submissions) || s.limits.cells < 1 || s.limits.submissions < 0 || s.limits.activeTime < 0 || !Array.isArray(s.queue) || !s.queue.every((x: unknown) => typeof x === 'string') || !Array.isArray(s.admitted) || !s.cells || typeof s.cells !== 'object' || !Array.isArray(s.candidates) || !Array.isArray(s.gaps) || !Array.isArray(s.blocked) || !Array.isArray(s.attempts) || ![s.submissions, s.activeTime].every(Number.isFinite) || s.submissions < 0 || s.activeTime < 0 || typeof s.paused !== 'boolean' || typeof s.cancelled !== 'boolean') throw new Error('Corrupt traversal checkpoint');
  try { validateGeometry(s.geometry); } catch { throw new Error('Corrupt traversal checkpoint'); }
  if (!Number.isSafeInteger(s.submissions) || s.submissions !== s.attempts.length + (Array.isArray(s.detailWork) ? s.detailWork.reduce((n: number, work: any) => n + (Array.isArray(work?.attempts) ? work.attempts.length : 0), 0) : 0) || !s.attempts.every((a: any) => a && typeof a.id === 'string' && a.id.length > 0 && typeof a.cellKey === 'string' && a.workId === `work:${a.cellKey}` && s.cells[a.cellKey] && ['reserved', 'dispatched', 'uncertain', 'observing', 'observed', 'skipped', 'confirmed_no_send'].includes(a.status)) || new Set(s.attempts.map((a: any) => a.id)).size !== s.attempts.length) throw new Error('Corrupt traversal checkpoint');
  if (!s.attempts.every((a: any) => a.knownId === undefined || (typeof a.knownId === 'string' && a.knownId.trim().length > 0)) || !s.attempts.every((a: any) => !['observing', 'observed'].includes(a.status) || (typeof a.knownId === 'string' && a.knownId.trim().length > 0)) || !s.attempts.every((a: any) => a.status !== 'confirmed_no_send' || (a.knownId === undefined && a.retryOrdinal === undefined && a.observationRetryCeiling === undefined && a.observationRetryPendingDelayMs === undefined && a.recoveryEvidence === undefined && a.safeRetryAuthorization === undefined && s.cells[a.cellKey]?.outcome === 'failed' && s.gaps.some((g: any) => g.cellKey === a.cellKey && g.cause === 'failed' && g.scope === 'isolated' && g.status === 'unresolved')))) throw new Error('Corrupt traversal checkpoint');
  if (s.cleanPauseEvidence !== undefined && (!s.cleanPauseEvidence || typeof s.cleanPauseEvidence !== 'object' || typeof s.cleanPauseEvidence.evidence !== 'string' || !s.cleanPauseEvidence.evidence.trim() || s.paused !== true || s.recoveryPending === true || s.activeInterval === true)) throw new Error('Corrupt traversal checkpoint');
  if (s.resendApprovalsConsumed !== undefined && (!Number.isSafeInteger(s.resendApprovalsConsumed) || s.resendApprovalsConsumed < 0) || s.resendCeiling !== undefined && (!Number.isSafeInteger(s.resendCeiling) || s.resendCeiling < 1) || !s.attempts.every((a: any) => a.resendOrdinal === undefined || a.resendCeiling === s.resendCeiling) || !s.attempts.every((a: any) => ['submissionRetryOrdinal', 'retryOrdinal', 'retryCeiling', 'observationRetryCeiling', 'submissionRetryCeiling', 'resendOrdinal', 'resendCeiling'].every(key => a[key] === undefined || (Number.isSafeInteger(a[key]) && a[key] >= 0)) && (a.retryCeiling === undefined || a.retryOrdinal === undefined || a.retryOrdinal <= a.retryCeiling) && (a.observationRetryCeiling === undefined || a.retryOrdinal === undefined || a.retryOrdinal <= a.observationRetryCeiling) && !(a.observationRetryCeiling !== undefined && a.retryCeiling !== undefined) && (a.resendOrdinal === undefined ? a.resendCeiling === undefined && a.approval === undefined : Number.isSafeInteger(a.resendCeiling) && a.resendOrdinal > 0 && a.resendOrdinal <= a.resendCeiling && a.approval && typeof a.approval.rationale === 'string' && !!a.approval.rationale.trim()) && (a.submissionRetryCeiling === undefined || (a.submissionRetryOrdinal ?? 0) <= a.submissionRetryCeiling) && !(a.submissionRetryOrdinal !== undefined && a.submissionRetryCeiling === undefined && a.retryCeiling !== undefined && a.submissionRetryOrdinal > a.retryCeiling) && !(a.submissionRetryOrdinal !== undefined && a.submissionRetryCeiling === undefined && a.retryOrdinal !== undefined && a.retryCeiling !== undefined))) throw new Error('Corrupt traversal checkpoint');
  const resendAttempts = s.attempts.filter((a: any) => a.resendOrdinal !== undefined);
  const approvalHistory = s.attempts.filter((a: any) => a.approval !== undefined);
  if ((s.resendApprovalsConsumed === undefined ? approvalHistory.length > 0 || s.resendCeiling !== undefined : s.resendApprovalsConsumed !== approvalHistory.length) || approvalHistory.length !== resendAttempts.length) throw new Error('Corrupt traversal checkpoint');
  if (!resendAttempts.every((attempt: any, index: number) => attempt.resendOrdinal === index + 1 && attempt.resendCeiling === s.resendCeiling)) throw new Error('Corrupt traversal checkpoint');
  if (!s.attempts.every((a: any) => a.observationRetryPendingDelayMs === undefined || (Number.isSafeInteger(a.observationRetryPendingDelayMs) && a.observationRetryPendingDelayMs >= 0 && a.status === 'observing' && typeof a.knownId === 'string' && a.retryOrdinal > 0 && a.observationRetryCeiling >= a.retryOrdinal))) throw new Error('Corrupt traversal checkpoint');
  if (!s.attempts.every((a: any) => a.safeRetryAuthorization === undefined || (a.safeRetryAuthorization && Number.isSafeInteger(a.safeRetryAuthorization.ordinal) && a.safeRetryAuthorization.ordinal > 0 && Number.isSafeInteger(a.safeRetryAuthorization.ceiling) && a.safeRetryAuthorization.ceiling >= a.safeRetryAuthorization.ordinal && (a.safeRetryAuthorization.delayMs === undefined || (Number.isSafeInteger(a.safeRetryAuthorization.delayMs) && a.safeRetryAuthorization.delayMs >= 0)) && a.safeRetryAuthorization.ordinal === (a.submissionRetryOrdinal ?? 0) + 1))) throw new Error('Corrupt traversal checkpoint');
  if (!s.gaps.every((g: any) => g && typeof g.cellKey === 'string' && Object.hasOwn(s.cells, g.cellKey)) || !s.candidates.every((c: any) => c && Object.hasOwn(s.cells, c.sourceCell) && s.attempts.some((a: any) => a.id === c.attemptId && a.cellKey === c.sourceCell))) throw new Error('Corrupt traversal checkpoint');
  if (s.detailWork !== undefined) {
    const observationById = new Map(s.candidates.map((c: any) => [c.observationId, c]));
    if (observationById.size !== s.candidates.length) throw new Error('Corrupt traversal checkpoint');
    const workIds = new Set<string>();
    const linkedObservations = new Set<string>();
    if (!Array.isArray(s.detailWork) || !s.detailWork.every((work: any) => {
      if (!work || typeof work.id !== 'string' || !work.id || workIds.has(work.id) || !['pending', 'reserved', 'dispatched', 'uncertain', 'completed', 'skipped'].includes(work.status) || !Array.isArray(work.attempts) || !work.attempts.every((attempt: any) => attempt && typeof attempt.id === 'string' && ['reserved', 'dispatched', 'uncertain', 'completed', 'skipped'].includes(attempt.status) && (attempt.knownId === undefined || (typeof attempt.knownId === 'string' && !!attempt.knownId.trim())) && ['observationRetryOrdinal', 'observationRetryCeiling', 'observationRetryPendingDelayMs'].every(key => attempt[key] === undefined || (Number.isSafeInteger(attempt[key]) && attempt[key] >= 0)) && (attempt.observationRetryDisposition === undefined || ['initial', 'authorized', 'closed'].includes(attempt.observationRetryDisposition)) && (attempt.observationRetryOrdinal === undefined ? attempt.observationRetryCeiling === undefined && attempt.observationRetryPendingDelayMs === undefined : Number.isSafeInteger(attempt.observationRetryCeiling) && attempt.observationRetryOrdinal > 0 && attempt.observationRetryOrdinal <= attempt.observationRetryCeiling) && (attempt.observationRetryPendingDelayMs === undefined || (attempt.status === 'uncertain' && typeof attempt.knownId === 'string' && attempt.observationRetryDisposition === 'authorized'))) || typeof work.identity !== 'string' || !work.identity || !Array.isArray(work.observationIds) || work.observationIds.length === 0) return false;
      workIds.add(work.id);
      const verified = work.identity.startsWith('verified:');
      const identityKey = verified ? work.identity.slice('verified:'.length) : undefined;
      if (verified && (!identityKey || work.id !== `detail:${work.identity}`)) return false;
      if (!verified && work.id !== `detail:${work.identity}`) return false;
      const local = new Set<string>();
      for (const id of work.observationIds) {
        const candidate = observationById.get(id) as any;
        if (typeof id !== 'string' || !candidate || local.has(id) || linkedObservations.has(id)) return false;
        local.add(id); linkedObservations.add(id);
        if (verified ? candidate.verifiedCanonicalKey !== identityKey : work.identity !== `observation:${id}` || candidate.verifiedCanonicalKey !== undefined) return false;
      }
      return !verified || new Set(work.observationIds.map((id: string) => (observationById.get(id) as any)?.verifiedCanonicalKey)).size === 1;
    })) throw new Error('Corrupt traversal checkpoint');
    if (linkedObservations.size !== observationById.size) throw new Error('Corrupt traversal checkpoint');
    const attemptIds = new Set(s.attempts.map((attempt: any) => attempt.id));
    for (const work of s.detailWork) {
      if (work.attempts.some((attempt: any, index: number) => {
        const hasOrdinal = attempt.observationRetryOrdinal !== undefined;
        const hasCeiling = attempt.observationRetryCeiling !== undefined;
        const hasPendingDelay = attempt.observationRetryPendingDelayMs !== undefined;
        const hasRetryHistory = hasOrdinal && hasCeiling && Number.isSafeInteger(attempt.observationRetryOrdinal) && attempt.observationRetryOrdinal > 0 && Number.isSafeInteger(attempt.observationRetryCeiling) && attempt.observationRetryCeiling >= attempt.observationRetryOrdinal;
        const hasRetryAuthorization = attempt.observationRetryDisposition === 'authorized';
        const hasRetryState = hasOrdinal || hasCeiling || hasPendingDelay || hasRetryAuthorization;
        return (hasOrdinal !== hasCeiling) || (hasRetryState && (index !== work.attempts.length - 1 || !attempt.knownId || !['uncertain', 'completed'].includes(attempt.status) || !hasRetryHistory)) || (hasRetryAuthorization && (attempt.status !== 'uncertain' || !hasPendingDelay)) || (hasPendingDelay && (attempt.status !== 'uncertain' || !Number.isSafeInteger(attempt.observationRetryPendingDelayMs) || attempt.observationRetryPendingDelayMs < 0));
      })) throw new Error('Corrupt traversal checkpoint');
      if ((work.status === 'pending' && work.attempts.length !== 0) || (work.status !== 'pending' && work.attempts.length === 0)) throw new Error('Corrupt traversal checkpoint');
      if (work.attempts.some((attempt: any, index: number) => attempt.id !== `${work.id}:attempt:${index + 1}` || attemptIds.has(attempt.id))) throw new Error('Corrupt traversal checkpoint');
      for (const attempt of work.attempts) attemptIds.add(attempt.id);
      const last = work.attempts.at(-1)?.status;
      if (work.attempts.slice(0, -1).some((attempt: any) => attempt.status === 'reserved' || attempt.status === 'dispatched') || (work.status === 'reserved' && last !== 'reserved') || (work.status === 'dispatched' && last !== 'dispatched') || (work.status === 'uncertain' && last !== 'uncertain') || (work.status === 'completed' && (last !== 'completed' || !work.attempts.at(-1)?.knownId)) || (work.status === 'skipped' && last !== 'skipped')) throw new Error('Corrupt traversal checkpoint');
    }
  }
  const originBlockers = s.detailOriginBlockers;
  const hasTaggedOriginGap = s.gaps.some((gap: any) => typeof gap?.id === 'string' && gap.id.startsWith('detail-origin:'));
  if (originBlockers === null || (originBlockers === undefined && hasTaggedOriginGap)) throw new Error('Corrupt traversal checkpoint');
  const effectiveOriginBlockers = originBlockers ?? [];
  if (!Array.isArray(effectiveOriginBlockers) || !effectiveOriginBlockers.every((blocker: any) => blocker && typeof blocker.workId === 'string' && typeof blocker.cellKey === 'string' && ['unresolved', 'resolved'].includes(blocker.status))) throw new Error('Corrupt traversal checkpoint');
  const originKeys = new Set<string>();
  const originWorkIds = new Set<string>();
  const originGapIds = new Set<string>();
  for (const blocker of effectiveOriginBlockers) {
    const key = `${blocker.workId}\\0${blocker.gapId}`;
    const work = s.detailWork?.find((item: any) => item.id === blocker.workId);
    const cellGaps = s.gaps.filter((gap: any) => gap.cellKey === blocker.cellKey && gap.cause === 'uncertain' && gap.scope === 'global');
    const resolved = blocker.status === 'resolved';
    if (blocker === null || blocker.gapId !== `detail-origin:${blocker.workId}` || originKeys.has(key) || originWorkIds.has(blocker.workId) || originGapIds.has(blocker.gapId) || cellGaps.filter((gap: any) => gap.id === blocker.gapId).length !== 1 || cellGaps.find((gap: any) => gap.id === blocker.gapId)?.status !== (resolved ? 'resolved' : 'unresolved') || !work || !['uncertain', 'completed'].includes(work.status) || !work.observationIds.some((id: string) => s.candidates.some((candidate: any) => candidate.observationId === id && candidate.sourceCell === blocker.cellKey)) || !s.detailGaps?.some((gap: any) => gap.workId === blocker.workId && gap.status === (resolved ? 'resolved' : 'unresolved'))) throw new Error('Corrupt traversal checkpoint');
    originKeys.add(key);
    originWorkIds.add(blocker.workId);
    originGapIds.add(blocker.gapId);
  }
  if (s.gaps.some((gap: any) => Object.hasOwn(gap, 'detailOriginWorkId')) || s.gaps.some((gap: any) => typeof gap?.id === 'string' && gap.id.startsWith('detail-origin:') && effectiveOriginBlockers.filter((blocker: any) => blocker?.gapId === gap.id && blocker.cellKey === gap.cellKey && blocker.status === gap.status).length !== 1)) throw new Error('Corrupt traversal checkpoint');
  if (s.detailGaps !== undefined) {
    const detailGapWorkIds = new Set<string>();
    if (!Array.isArray(s.detailGaps) || !s.detailGaps.every((gap: any) => {
      if (typeof gap?.workId !== 'string' || detailGapWorkIds.has(gap.workId)) return false;
      detailGapWorkIds.add(gap.workId);
      const work = s.detailWork?.find((item: any) => item.id === gap?.workId);
      if (!work || gap.identity !== work.identity || !Array.isArray(gap.observationIds) || gap.observationIds.length === 0 || new Set(gap.observationIds).size !== gap.observationIds.length || !gap.observationIds.every((id: string) => work.observationIds.includes(id)) || !['unresolved', 'resolved', 'skipped'].includes(gap.status)) return false;
      if (gap.status !== 'resolved') return true;
      const key = work.identity.startsWith('verified:') ? work.identity.slice('verified:'.length) : '';
      return !!key && gap.observationIds.every((id: string) => s.candidates.some((candidate: any) => candidate.observationId === id && candidate.verifiedCanonicalKey === key)) && work.attempts.some((attempt: any) => attempt.status === 'completed' && typeof attempt.knownId === 'string' && attempt.knownId.trim().length > 0);
    })) throw new Error('Corrupt traversal checkpoint');
  }
  const validCellKey = (key: string): boolean => {
    const match = /^(-?(?:0|[1-9][0-9]*)),(-?(?:0|[1-9][0-9]*))$/.exec(key);
    if (!match) return false;
    const column = Number(match[1]), row = Number(match[2]);
    return Number.isSafeInteger(column) && Number.isSafeInteger(row) && cellKey(column, row) === key && isCellEligible(s.geometry, column, row);
  };
  if (!s.candidates.every((c: any) => c && typeof c === 'object' && typeof c.id === 'string' && c.id.length > 0 && (c.coordinate === undefined || c.coordinate === null || (c.coordinate && Number.isFinite(c.coordinate.latitude) && c.coordinate.latitude >= -90 && c.coordinate.latitude <= 90 && Number.isFinite(c.coordinate.longitude) && c.coordinate.longitude >= -180 && c.coordinate.longitude <= 180)) && ['inside', 'outside', 'unverified'].includes(c.classification) && typeof c.sourceCell === 'string' && typeof c.observationId === 'string' && typeof c.attemptId === 'string' && (c.verifiedCanonicalKey === undefined || (typeof c.verifiedCanonicalKey === 'string' && c.verifiedCanonicalKey.trim().length > 0)) && Number.isSafeInteger(c.occurrence) && c.occurrence > 0) || !s.gaps.every((g: any) => g && typeof g === 'object' && typeof g.cellKey === 'string' && ['failed', 'unrecognized', 'uncertain'].includes(g.cause) && (g.scope === undefined || ['isolated', 'global'].includes(g.scope)) && (g.status === undefined || ['unresolved', 'resolved', 'skipped'].includes(g.status))) || !s.blocked.every((key: any) => typeof key === 'string' && validCellKey(key)) || new Set(s.queue).size !== s.queue.length || s.admitted.length > s.limits.cells || new Set(s.admitted).size !== s.admitted.length || !s.admitted.every((key: unknown) => typeof key === 'string' && validCellKey(key) && !!s.cells[key]) || !Object.keys(s.cells).every((key: string) => validCellKey(key) && s.admitted.includes(key)) || !s.queue.every((key: string) => s.cells[key]?.outcome === 'queued' && s.admitted.includes(key)) || !Object.entries(s.cells).every(([key, cell]: [string, any]) => cell && typeof cell === 'object' && ['queued', 'running', 'parked', 'nonempty', 'empty', 'failed', 'unrecognized'].includes(cell.outcome) && (cell.outcome !== 'queued' || s.queue.includes(key))) || !s.attempts.every((a: any) => validCellKey(a.cellKey))) throw new Error('Corrupt traversal checkpoint');
}

/** Durable checkpoint foundation; this does not implement restartable discovery. */
export class DurableState {
  #ownerReleased = false;
  private constructor(private db: DatabaseSync) {}
  static createBound(path: string, fixtureIdentity: string, traversal: TraversalState): void {
    if (typeof fixtureIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(fixtureIdentity)) throw new Error('Invalid fixture identity');
    const serializedTraversal = JSON.stringify(traversal);
    validateTraversal(JSON.parse(serializedTraversal));
    if (traversal.timeUnit !== 'milliseconds') throw new Error('Durable traversal time unit is unmarked; explicit migration required');
    const staging = mkdtempSync(join(dirname(path), `.${basename(path)}.init-`));
    const stagingPath = join(staging, 'checkpoint.db');
    try {
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        try { lstatSync(`${path}${suffix}`); throw new Error(suffix ? 'Corrupt state: orphan SQLite sidecar without checkpoint' : 'Checkpoint already exists'); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      const staged = new DatabaseSync(stagingPath);
      try {
        staged.exec('PRAGMA journal_mode=DELETE; CREATE TABLE checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL); CREATE TABLE operator_binding (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE traversal (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);');
        staged.prepare('INSERT INTO checkpoint VALUES(1,1,?)').run('{"version":1,"work":[],"observations":[],"gaps":[]}');
        staged.prepare('INSERT INTO operator_binding VALUES(1,?)').run(JSON.stringify({ version: 1, fixtureIdentity }));
        staged.prepare('INSERT INTO traversal VALUES(1,?)').run(serializedTraversal);
        staged.close();
      } catch (error) {
        try { staged.close(); } catch { /* Preserve the staging failure. */ }
        throw error;
      }
      beforePublishForTest?.();
      try { linkSync(stagingPath, path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Checkpoint already exists');
        throw error;
      }
      afterCreateForTest?.();
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  static acquireCancelOnly(path: string): CancelOnlyAcquisition {
    const db = new DatabaseSync(path);
    try {
      db.exec('BEGIN IMMEDIATE');
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name));
      if (!tables.has('checkpoint') || !tables.has('owner') || !tables.has('operator_binding') || !tables.has('traversal')) throw new Error('Corrupt state: missing bound checkpoint schema');
      const checkpoint = db.prepare('SELECT version, payload FROM checkpoint WHERE id=1').get();
      if (!checkpoint || checkpoint.version !== 1) throw new Error('Unsupported or missing checkpoint schema version');
      validate(JSON.parse(String(checkpoint.payload)));
      const binding = db.prepare('SELECT payload FROM operator_binding WHERE id=1').get();
      if (!binding) throw new Error('Corrupt state: missing operator binding');
      let parsedBinding: unknown;
      try { parsedBinding = JSON.parse(String(binding.payload)); } catch { throw new Error('Corrupt state: invalid operator binding'); }
      if (!parsedBinding || typeof parsedBinding !== 'object' || Array.isArray(parsedBinding) || Object.keys(parsedBinding).length !== 2 || (parsedBinding as any).version !== 1 || typeof (parsedBinding as any).fixtureIdentity !== 'string' || !/^[a-f0-9]{64}$/.test((parsedBinding as any).fixtureIdentity)) throw new Error('Corrupt state: invalid operator binding');
      const traversalRow = db.prepare('SELECT payload FROM traversal WHERE id=1').get();
      if (!traversalRow) throw new Error('Corrupt state: missing traversal');
      const traversal = JSON.parse(String(traversalRow.payload));
      validateTraversal(traversal);
      if (traversal.timeUnit !== 'milliseconds') throw new Error('Durable traversal time unit is unmarked; explicit migration required');
      const owner = db.prepare('SELECT pid FROM owner WHERE id=1').get();
      let recoveredPreviousOwner = false;
      afterOwnerReadForTest?.();
      if (owner) {
        const pid = owner.pid;
        if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) throw new Error('Corrupt state: invalid owner PID');
        if (isAlive(pid)) throw new Error('Database is already owned');
        recoveredPreviousOwner = true;
      }
      if (traversal.activeInterval === true || (recoveredPreviousOwner && !traversal.cleanPauseEvidence)) {
        db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...traversal, recoveryPending: true, activeInterval: false }));
      } else if (recoveredPreviousOwner) {
        db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...traversal, recoveryPending: false }));
      }
      db.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(process.pid);
      db.exec('COMMIT');
      return new CancelOnlyAcquisition(db);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Preserve acquisition failure. */ }
      try { db.close(); } catch { /* Preserve acquisition failure. */ }
      throw error;
    }
  }
  static openBound(path: string, fixtureIdentity: string): DurableState {
    if (typeof fixtureIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(fixtureIdentity)) throw new Error('Invalid fixture identity');
    const db = new DatabaseSync(path);
    try {
      db.exec('BEGIN IMMEDIATE');
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name));
      if (!tables.has('checkpoint') || !tables.has('owner') || !tables.has('operator_binding') || !tables.has('traversal')) throw new Error('Corrupt state: missing bound checkpoint schema');
      const checkpoint = db.prepare('SELECT version, payload FROM checkpoint WHERE id=1').get();
      if (!checkpoint || checkpoint.version !== 1) throw new Error('Unsupported or missing checkpoint schema version');
      validate(JSON.parse(String(checkpoint.payload)));
      const binding = db.prepare('SELECT payload FROM operator_binding WHERE id=1').get();
      if (!binding) throw new Error('Corrupt state: missing operator binding');
      let parsedBinding: unknown;
      try { parsedBinding = JSON.parse(String(binding.payload)); } catch { throw new Error('Corrupt state: invalid operator binding'); }
      if (!parsedBinding || typeof parsedBinding !== 'object' || Array.isArray(parsedBinding) || Object.keys(parsedBinding).length !== 2 || (parsedBinding as any).version !== 1 || typeof (parsedBinding as any).fixtureIdentity !== 'string' || !/^[a-f0-9]{64}$/.test((parsedBinding as any).fixtureIdentity)) throw new Error('Corrupt state: invalid operator binding');
      if ((parsedBinding as any).fixtureIdentity !== fixtureIdentity) throw new Error('Fixture identity does not match checkpoint binding');
      const traversalRow = db.prepare('SELECT payload FROM traversal WHERE id=1').get();
      if (!traversalRow) throw new Error('Corrupt state: missing traversal');
      const traversal = JSON.parse(String(traversalRow.payload));
      validateTraversal(traversal);
      if (traversal.timeUnit !== 'milliseconds') throw new Error('Durable traversal time unit is unmarked; explicit migration required');
      const owner = db.prepare('SELECT pid FROM owner WHERE id=1').get();
      let recoveredPreviousOwner = false;
      afterOwnerReadForTest?.();
      if (owner) {
        const pid = owner.pid;
        if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) throw new Error('Corrupt state: invalid owner PID');
        if (isAlive(pid)) throw new Error('Database is already owned');
        recoveredPreviousOwner = true;
      }
      if (traversal.activeInterval === true || (recoveredPreviousOwner && !traversal.cleanPauseEvidence)) {
        db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...traversal, recoveryPending: true, activeInterval: false }));
      } else if (recoveredPreviousOwner) {
        db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...traversal, recoveryPending: false }));
      }
      db.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(process.pid);
      db.exec('COMMIT');
      return new DurableState(db);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (rollbackError) { if (!(rollbackError instanceof Error)) throw rollbackError; }
      try { db.close(); } catch (closeError) { if (!(closeError instanceof Error)) throw closeError; }
      throw error;
    }
  }
  static open(path: string): DurableState {
    let db: DatabaseSync;
    const staging = mkdtempSync(join(dirname(path), `.${basename(path)}.init-`));
    const stagingPath = join(staging, 'checkpoint.db');
    try {
      let exists = true;
      try { closeSync(openSync(path, 'r')); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') exists = false;
        else throw error;
      }
      if (!exists) {
        for (const suffix of ['-journal', '-wal', '-shm']) {
          try { lstatSync(`${path}${suffix}`); throw new Error('Corrupt state: orphan SQLite sidecar without checkpoint'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        const staged = new DatabaseSync(stagingPath);
        staged.exec('PRAGMA journal_mode=DELETE; CREATE TABLE checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL); INSERT INTO checkpoint VALUES(1,1,\'{"version":1,"work":[],"observations":[],"gaps":[]}\');');
        staged.close();
        beforePublishForTest?.();
        try { linkSync(stagingPath, path); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
    } finally { rmSync(staging, { recursive: true, force: true }); }
    afterCreateForTest?.();
    db = new DatabaseSync(path);
    try {
      const bound = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='operator_binding'").get();
      if (bound) throw new Error('DurableState.open cannot open an operator-bound checkpoint');
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS traversal (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); BEGIN IMMEDIATE');
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('checkpoint','owner')").all().map((r: any) => r.name);
      if (!tables.includes('checkpoint') || !tables.includes('owner')) throw new Error('Corrupt state: missing required table');
      const row = db.prepare('SELECT version, payload FROM checkpoint WHERE id=1').get();
      if (row) { if (row.version !== 1) throw new Error('Unsupported schema version'); validate(JSON.parse(String(row.payload))); }
      else throw new Error('Corrupt state: missing checkpoint');
      const owner = db.prepare('SELECT pid FROM owner WHERE id=1').get();
      let recoveredPreviousOwner = false;
      afterOwnerReadForTest?.();
      if (owner) {
        const pid = owner.pid;
        if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) throw new Error('Corrupt state: invalid owner PID');
        if (isAlive(pid)) throw new Error('Database is already owned');
        recoveredPreviousOwner = true;
      }
      const traversalRow = db.prepare('SELECT payload FROM traversal WHERE id=1').get();
      if (traversalRow) {
        const traversal = JSON.parse(String(traversalRow.payload));
        validateTraversal(traversal);
        // The durable interval marker survives orderly close; ownership alone cannot
        // determine whether active accounting was interrupted.
        if (traversal.activeInterval === true || (recoveredPreviousOwner && !traversal.cleanPauseEvidence)) {
          db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...traversal, recoveryPending: true, activeInterval: false }));
        } else if (recoveredPreviousOwner) {
          db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...traversal, recoveryPending: false }));
        }
      }
      db.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(process.pid);
      db.exec('COMMIT');
      return new DurableState(db);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (rollbackError) { if (!(rollbackError instanceof Error)) throw rollbackError; }
      try { db.close(); } catch (closeError) { if (!(closeError instanceof Error)) throw closeError; }
      throw error;
    }
  }
  read(): Snapshot { const row = this.db.prepare('SELECT version, payload FROM checkpoint WHERE id=1').get(); if (!row || row.version !== 1) throw new Error('Unsupported schema version'); const value = JSON.parse(String(row.payload)); validate(value); return value; }
  transition(change: (state: Snapshot) => Snapshot): void {
    this.db.exec('BEGIN IMMEDIATE');
    try { const next = change(this.read()); validate(next); this.db.prepare('UPDATE checkpoint SET payload=? WHERE id=1').run(JSON.stringify(next)); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  readTraversal(): TraversalState {
    const row = this.db.prepare('SELECT payload FROM traversal WHERE id=1').get();
    if (!row) throw new Error('Durable traversal has not been initialized');
    const value: any = JSON.parse(String(row.payload));
    validateTraversal(value);
    if (value.timeUnit !== 'milliseconds') throw new Error('Durable traversal time unit is unmarked; explicit migration required');
    return value;
  }
  readTraversalSnapshot(): TraversalState {
    this.db.exec('BEGIN');
    try { const snapshot = this.readTraversal(); this.db.exec('COMMIT'); return snapshot; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  migrateDurableTimeUnits(activeTime: number, activeTimeLimit: number, evidence: string): void {
    if (!Number.isFinite(activeTime) || activeTime < 0 || !Number.isFinite(activeTimeLimit) || activeTimeLimit < 0 || typeof evidence !== 'string' || !evidence.trim()) throw new Error('Invalid durable time migration');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT payload FROM traversal WHERE id=1').get();
      if (!row) throw new Error('Durable traversal has not been initialized');
      const value: any = JSON.parse(String(row.payload));
      if (value.timeUnit !== undefined) throw new Error('Durable traversal time unit is already marked');
      validateTraversal({ ...value, timeUnit: 'milliseconds' });
      const migrated = { ...value, timeUnit: 'milliseconds', activeTime, limits: { ...value.limits, activeTime: activeTimeLimit }, timeUnitMigrationEvidence: evidence.trim() };
      validateTraversal(migrated);
      this.db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify(migrated));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  writeTraversal(state: TraversalState): void {
    const payload = JSON.stringify(state);
    const serialized = JSON.parse(payload);
    validateTraversal(serialized);
    if (serialized.timeUnit !== 'milliseconds') throw new Error('Durable traversal time unit is unmarked; explicit migration required');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT payload FROM traversal WHERE id=1').get();
      const previous = existing ? JSON.parse(String(existing.payload)) : undefined;
      if (previous && previous.timeUnit !== 'milliseconds') throw new Error('Durable traversal time unit is unmarked; explicit migration required');
      if (previous?.activeInterval === true && serialized.cancelled !== previous.cancelled) throw new Error('Cannot control traversal during an active interval');
      this.db.prepare('INSERT INTO traversal(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(payload);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  beginActiveInterval(): void {
    this.transitionTraversal(value => {
      if (value.recoveryPending || value.activeInterval === true || value.cleanPauseEvidence !== undefined) throw new Error('Active interval cannot begin');
      return { ...value, activeInterval: true };
    });
  }
  settleActiveInterval(elapsed: number): void {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid elapsed time');
    this.transitionTraversal(value => {
      if (value.activeInterval !== true) throw new Error('No active interval to settle');
      if (!Number.isFinite(value.activeTime + elapsed)) throw new Error('Elapsed time exceeds finite accounting range');
      return { ...value, activeTime: value.activeTime + elapsed };
    });
  }
  endActiveInterval(): void {
    this.transitionTraversal(value => {
      if (value.activeInterval !== true) throw new Error('No active interval to end');
      return { ...value, activeInterval: false };
    });
  }
  cancel(): TraversalState {
    this.transitionTraversal(value => cancelTraversal(value));
    return this.readTraversal();
  }
  transitionTraversal(change: (state: TraversalState) => TraversalState): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.readTraversal();
      const wasActive = previous.activeInterval === true;
      const wasCancelled = previous.cancelled;
      const next = change(previous);
      const payload = JSON.stringify(next);
      const serialized = JSON.parse(payload);
      validateTraversal(serialized);
      if (serialized.timeUnit !== 'milliseconds') throw new Error('Durable traversal time unit is unmarked; explicit migration required');
      if (wasActive && serialized.cancelled !== wasCancelled) throw new Error('Cannot control traversal during an active interval');
      this.db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(payload);
      afterTraversalWriteForTest?.();
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  releaseOwner(): void {
    if (this.#ownerReleased) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('DELETE FROM owner WHERE id=1 AND pid=?').run(process.pid);
      if (Number(result.changes) !== 1) throw new Error('Writer ownership was not released');
      this.db.exec('COMMIT');
      this.#ownerReleased = true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void {
    let failure: unknown;
    try { this.releaseOwner(); } catch (error) { failure = error; }
    try { this.db.close(); } catch (error) { failure ??= error; }
    if (failure !== undefined) throw failure;
  }
}
export class CancelOnlyAcquisition {
  #db: DatabaseSync;
  #ownerReleased = false;
  constructor(db: DatabaseSync) { this.#db = db; }
  #readTraversal(): TraversalState {
    const row = this.#db.prepare('SELECT payload FROM traversal WHERE id=1').get();
    if (!row) throw new Error('Corrupt state: missing traversal');
    const state = JSON.parse(String(row.payload));
    validateTraversal(state);
    return state;
  }
  snapshot(): TraversalState {
    this.#db.exec('BEGIN');
    try { const snapshot = this.#readTraversal(); this.#db.exec('COMMIT'); return snapshot; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  releaseOwner(): void {
    if (this.#ownerReleased) return;
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.#db.prepare('DELETE FROM owner WHERE id=1 AND pid=?').run(process.pid);
      if (Number(result.changes) !== 1) throw new Error('Writer ownership was not released');
      this.#db.exec('COMMIT');
      this.#ownerReleased = true;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  cancel(): TraversalState {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.#readTraversal();
      if (state.activeInterval === true) throw new Error('Cannot control traversal during an active interval');
      const next = cancelTraversal(state);
      validateTraversal(next);
      this.#db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify(next));
      this.#db.exec('COMMIT');
      return next;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  close(): void {
    let failure: unknown;
    try { this.releaseOwner(); } catch (error) { failure = error; }
    try { this.#db.close(); } catch (error) { failure ??= error; }
    if (failure !== undefined) throw failure;
  }
}
function isAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code === 'EPERM') return true; if (code === 'ESRCH') return false; throw new Error(`Cannot establish owner PID status: ${code ?? error}`); } }
