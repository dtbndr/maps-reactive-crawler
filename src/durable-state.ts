import { DatabaseSync } from 'node:sqlite';
import { closeSync, linkSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

type Snapshot = { version: 1; work: { id: string; status: string }[]; observations: unknown[]; gaps: unknown[] };
const initial = (): Snapshot => ({ version: 1, work: [], observations: [], gaps: [] });
let afterOwnerReadForTest: (() => void) | undefined;
let afterCreateForTest: (() => void) | undefined;
/** Internal synchronization seam for deterministic ownership-race tests. */
export function setAfterOwnerReadForTest(hook: (() => void) | undefined): void { afterOwnerReadForTest = hook; }
/** Internal synchronization seam for deterministic creation-race tests. */
export function setAfterCreateForTest(hook: (() => void) | undefined): void { afterCreateForTest = hook; }
function validate(value: unknown): asserts value is Snapshot {
  if (!value || typeof value !== 'object' || (value as any).version !== 1 || !Array.isArray((value as any).work) || !(value as any).work.every((entry: any) => entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.status === 'string') || !Array.isArray((value as any).observations) || !Array.isArray((value as any).gaps)) throw new Error('Unsupported or corrupt state');
}

/** Durable checkpoint foundation; this does not implement restartable discovery. */
export class DurableState {
  private constructor(private db: DatabaseSync) {}
  static open(path: string): DurableState {
    let created = false;
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
        const staged = new DatabaseSync(stagingPath);
        staged.exec('PRAGMA journal_mode=DELETE; CREATE TABLE checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL); INSERT INTO checkpoint VALUES(1,1,\'{"version":1,"work":[],"observations":[],"gaps":[]}\');');
        staged.close();
        afterCreateForTest?.();
        try { linkSync(stagingPath, path); created = true; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
    } finally { rmSync(staging, { recursive: true, force: true }); }
    db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('checkpoint','owner')").all().map((r: any) => r.name);
      const userTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length === 0 && created && userTables.length === 0) {
        db.exec('CREATE TABLE checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL);');
      } else if (!tables.includes('checkpoint') || !tables.includes('owner')) throw new Error('Corrupt state: missing required table');
      const row = db.prepare('SELECT version, payload FROM checkpoint WHERE id=1').get();
      if (row) { if (row.version !== 1) throw new Error('Unsupported schema version'); validate(JSON.parse(String(row.payload))); }
      else if (!created && tables.length !== 0) throw new Error('Corrupt state: missing checkpoint');
      const owner = db.prepare('SELECT pid FROM owner WHERE id=1').get();
      afterOwnerReadForTest?.();
      if (owner) {
        const pid = owner.pid;
        if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) throw new Error('Corrupt state: invalid owner PID');
        if (isAlive(pid)) throw new Error('Database is already owned');
      }
      db.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(process.pid);
      if (!row) db.prepare('INSERT INTO checkpoint(id,version,payload) VALUES(1,1,?)').run(JSON.stringify(initial()));
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
  close(): void { this.db.prepare('DELETE FROM owner WHERE id=1 AND pid=?').run(process.pid); this.db.close(); }
}
function isAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { const code = (error as NodeJS.ErrnoException).code; if (code === 'EPERM') return true; if (code === 'ESRCH') return false; throw new Error(`Cannot establish owner PID status: ${code ?? error}`); } }
