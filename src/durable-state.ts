import { DatabaseSync } from 'node:sqlite';
import { closeSync, linkSync, mkdtempSync, openSync, rmSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { TraversalState } from './traversal.js';
import { cellKey, isCellEligible, validateGeometry } from './index.js';

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
  if (!s || typeof s !== 'object' || typeof s.recoveryPending !== 'undefined' && typeof s.recoveryPending !== 'boolean' || !s.geometry || !s.limits || ![s.limits.cells, s.limits.submissions, s.limits.activeTime].every(Number.isFinite) || !Number.isSafeInteger(s.limits.cells) || !Number.isSafeInteger(s.limits.submissions) || !Number.isSafeInteger(s.limits.cells) || !Number.isSafeInteger(s.limits.submissions) || s.limits.cells < 1 || s.limits.submissions < 0 || s.limits.activeTime < 0 || !Array.isArray(s.queue) || !s.queue.every((x: unknown) => typeof x === 'string') || !Array.isArray(s.admitted) || !s.cells || typeof s.cells !== 'object' || !Array.isArray(s.candidates) || !Array.isArray(s.gaps) || !Array.isArray(s.blocked) || !Array.isArray(s.attempts) || ![s.submissions, s.activeTime].every(Number.isFinite) || s.submissions < 0 || s.activeTime < 0 || typeof s.paused !== 'boolean' || typeof s.cancelled !== 'boolean') throw new Error('Corrupt traversal checkpoint');
  try { validateGeometry(s.geometry); } catch { throw new Error('Corrupt traversal checkpoint'); }
  if (!Number.isSafeInteger(s.submissions) || s.submissions !== s.attempts.length || !s.attempts.every((a: any) => a && typeof a.id === 'string' && a.id.length > 0 && typeof a.cellKey === 'string' && a.workId === `work:${a.cellKey}` && s.cells[a.cellKey] && ['reserved', 'dispatched', 'uncertain', 'observing', 'observed', 'skipped'].includes(a.status)) || new Set(s.attempts.map((a: any) => a.id)).size !== s.attempts.length) throw new Error('Corrupt traversal checkpoint');
  if (!s.attempts.every((a: any) => a.knownId === undefined || (typeof a.knownId === 'string' && a.knownId.trim().length > 0)) || !s.attempts.every((a: any) => !['observing', 'observed'].includes(a.status) || (typeof a.knownId === 'string' && a.knownId.trim().length > 0))) throw new Error('Corrupt traversal checkpoint');
  if (s.cleanPauseEvidence !== undefined && (!s.cleanPauseEvidence || typeof s.cleanPauseEvidence !== 'object' || typeof s.cleanPauseEvidence.evidence !== 'string' || !s.cleanPauseEvidence.evidence.trim() || s.paused !== true || s.recoveryPending === true)) throw new Error('Corrupt traversal checkpoint');
  if (s.resendCeiling !== undefined && (!Number.isSafeInteger(s.resendCeiling) || s.resendCeiling < 1) || !s.attempts.every((a: any) => a.resendOrdinal === undefined || a.resendCeiling === s.resendCeiling) || !s.attempts.every((a: any) => ['submissionRetryOrdinal', 'retryOrdinal', 'retryCeiling', 'observationRetryCeiling', 'submissionRetryCeiling', 'resendOrdinal', 'resendCeiling'].every(key => a[key] === undefined || (Number.isSafeInteger(a[key]) && a[key] >= 0)) && (a.retryCeiling === undefined || a.retryOrdinal === undefined || a.retryOrdinal <= a.retryCeiling) && (a.observationRetryCeiling === undefined || a.retryOrdinal === undefined || a.retryOrdinal <= a.observationRetryCeiling) && !(a.observationRetryCeiling !== undefined && a.retryCeiling !== undefined) && (a.resendOrdinal === undefined ? a.resendCeiling === undefined && a.approval === undefined : Number.isSafeInteger(a.resendCeiling) && a.resendOrdinal > 0 && a.resendOrdinal <= a.resendCeiling && a.approval && typeof a.approval.rationale === 'string' && !!a.approval.rationale.trim()) && (a.submissionRetryCeiling === undefined || (a.submissionRetryOrdinal ?? 0) <= a.submissionRetryCeiling) && !(a.submissionRetryOrdinal !== undefined && a.submissionRetryCeiling === undefined && a.retryCeiling !== undefined && a.submissionRetryOrdinal > a.retryCeiling) && !(a.submissionRetryOrdinal !== undefined && a.submissionRetryCeiling === undefined && a.retryOrdinal !== undefined && a.retryCeiling !== undefined))) throw new Error('Corrupt traversal checkpoint');
  const resendAttempts = s.attempts.filter((a: any) => a.resendOrdinal !== undefined);
  if (!resendAttempts.every((attempt: any, index: number) => attempt.resendOrdinal === index + 1 && attempt.resendCeiling === s.resendCeiling)) throw new Error('Corrupt traversal checkpoint');
  if (!s.attempts.every((a: any) => a.observationRetryPendingDelayMs === undefined || (Number.isSafeInteger(a.observationRetryPendingDelayMs) && a.observationRetryPendingDelayMs >= 0 && a.status === 'observing' && typeof a.knownId === 'string' && a.retryOrdinal > 0 && a.observationRetryCeiling >= a.retryOrdinal))) throw new Error('Corrupt traversal checkpoint');
  if (!s.attempts.every((a: any) => a.safeRetryAuthorization === undefined || (a.safeRetryAuthorization && Number.isSafeInteger(a.safeRetryAuthorization.ordinal) && a.safeRetryAuthorization.ordinal > 0 && Number.isSafeInteger(a.safeRetryAuthorization.ceiling) && a.safeRetryAuthorization.ceiling >= a.safeRetryAuthorization.ordinal && (a.safeRetryAuthorization.delayMs === undefined || (Number.isSafeInteger(a.safeRetryAuthorization.delayMs) && a.safeRetryAuthorization.delayMs >= 0)) && a.safeRetryAuthorization.ordinal === (a.submissionRetryOrdinal ?? 0) + 1))) throw new Error('Corrupt traversal checkpoint');
  if (!s.gaps.every((g: any) => g && typeof g.cellKey === 'string' && Object.hasOwn(s.cells, g.cellKey)) || !s.candidates.every((c: any) => c && Object.hasOwn(s.cells, c.sourceCell) && s.attempts.some((a: any) => a.id === c.attemptId && a.cellKey === c.sourceCell))) throw new Error('Corrupt traversal checkpoint');
  const validCellKey = (key: string): boolean => {
    const match = /^(-?(?:0|[1-9][0-9]*)),(-?(?:0|[1-9][0-9]*))$/.exec(key);
    if (!match) return false;
    const column = Number(match[1]), row = Number(match[2]);
    return Number.isSafeInteger(column) && Number.isSafeInteger(row) && cellKey(column, row) === key && isCellEligible(s.geometry, column, row);
  };
  if (!s.candidates.every((c: any) => c && typeof c === 'object' && typeof c.id === 'string' && c.id.length > 0 && (c.coordinate === undefined || c.coordinate === null || (c.coordinate && Number.isFinite(c.coordinate.latitude) && c.coordinate.latitude >= -90 && c.coordinate.latitude <= 90 && Number.isFinite(c.coordinate.longitude) && c.coordinate.longitude >= -180 && c.coordinate.longitude <= 180)) && ['inside', 'outside', 'unverified'].includes(c.classification) && typeof c.sourceCell === 'string' && typeof c.observationId === 'string' && typeof c.attemptId === 'string' && Number.isSafeInteger(c.occurrence) && c.occurrence > 0) || !s.gaps.every((g: any) => g && typeof g === 'object' && typeof g.cellKey === 'string' && ['failed', 'unrecognized', 'uncertain'].includes(g.cause) && (g.scope === undefined || ['isolated', 'global'].includes(g.scope)) && (g.status === undefined || ['unresolved', 'resolved', 'skipped'].includes(g.status))) || !s.blocked.every((key: any) => typeof key === 'string' && validCellKey(key)) || new Set(s.queue).size !== s.queue.length || s.admitted.length > s.limits.cells || new Set(s.admitted).size !== s.admitted.length || !s.admitted.every((key: unknown) => typeof key === 'string' && validCellKey(key) && !!s.cells[key]) || !Object.keys(s.cells).every((key: string) => validCellKey(key) && s.admitted.includes(key)) || !s.queue.every((key: string) => s.cells[key]?.outcome === 'queued' && s.admitted.includes(key)) || !Object.entries(s.cells).every(([key, cell]: [string, any]) => cell && typeof cell === 'object' && ['queued', 'running', 'parked', 'nonempty', 'empty', 'failed', 'unrecognized'].includes(cell.outcome) && (cell.outcome !== 'queued' || s.queue.includes(key))) || !s.attempts.every((a: any) => validCellKey(a.cellKey))) throw new Error('Corrupt traversal checkpoint');
}

/** Durable checkpoint foundation; this does not implement restartable discovery. */
export class DurableState {
  private constructor(private db: DatabaseSync) {}
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
          try { statSync(`${path}${suffix}`); throw new Error('Corrupt state: orphan SQLite sidecar without checkpoint'); }
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
      if (recoveredPreviousOwner) {
        const traversalRow = db.prepare('SELECT payload FROM traversal WHERE id=1').get();
        if (traversalRow) {
          const traversal = JSON.parse(String(traversalRow.payload));
          validateTraversal(traversal);
          if (!traversal.cleanPauseEvidence) db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...traversal, recoveryPending: true }));
          else db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify({ ...traversal, recoveryPending: false }));
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
    const value: unknown = JSON.parse(String(row.payload));
    validateTraversal(value);
    return value;
  }
  writeTraversal(state: TraversalState): void {
    validateTraversal(state);
    this.db.prepare('INSERT INTO traversal(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(state));
  }
  transitionTraversal(change: (state: TraversalState) => TraversalState): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const next = change(this.readTraversal());
      validateTraversal(next);
      this.db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify(next));
      afterTraversalWriteForTest?.();
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { this.db.prepare('DELETE FROM owner WHERE id=1 AND pid=?').run(process.pid); this.db.close(); }
}
function isAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code === 'EPERM') return true; if (code === 'ESRCH') return false; throw new Error(`Cannot establish owner PID status: ${code ?? error}`); } }
