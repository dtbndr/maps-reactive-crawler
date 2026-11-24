import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

type Snapshot = { version: 1; work: { id: string; status: string }[]; observations: unknown[]; gaps: unknown[] };
const initial = (): Snapshot => ({ version: 1, work: [], observations: [], gaps: [] });
function validate(value: unknown): asserts value is Snapshot {
  if (!value || typeof value !== 'object' || (value as any).version !== 1 || !Array.isArray((value as any).work) || !Array.isArray((value as any).observations) || !Array.isArray((value as any).gaps)) throw new Error('Unsupported or corrupt state');
}

/** Durable checkpoint foundation; this does not implement restartable discovery. */
export class DurableState {
  private constructor(private db: DatabaseSync) {}
  static open(path: string): DurableState {
    const existed = existsSync(path);
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL);');
      const row = db.prepare('SELECT version, payload FROM checkpoint WHERE id=1').get();
      if (row) { if (row.version !== 1) throw new Error('Unsupported schema version'); validate(JSON.parse(String(row.payload))); }
      else if (existed) throw new Error('Corrupt state: missing checkpoint');
      const owner = db.prepare('SELECT pid FROM owner WHERE id=1').get();
      if (owner && isAlive(Number(owner.pid))) throw new Error('Database is already owned');
      db.exec('BEGIN IMMEDIATE');
      db.prepare('INSERT OR REPLACE INTO owner(id,pid) VALUES(1,?)').run(process.pid);
      if (!row) db.prepare('INSERT INTO checkpoint(id,version,payload) VALUES(1,1,?)').run(JSON.stringify(initial()));
      db.exec('COMMIT');
      return new DurableState(db);
    } catch (error) { try { db.close(); } catch {} throw error; }
  }
  read(): Snapshot { const row = this.db.prepare('SELECT payload FROM checkpoint WHERE id=1').get(); const value = JSON.parse(String(row?.payload)); validate(value); return value; }
  transition(change: (state: Snapshot) => Snapshot): void {
    this.db.exec('BEGIN IMMEDIATE');
    try { const next = change(this.read()); validate(next); this.db.prepare('UPDATE checkpoint SET payload=? WHERE id=1').run(JSON.stringify(next)); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { this.db.prepare('DELETE FROM owner WHERE id=1 AND pid=?').run(process.pid); this.db.close(); }
}
function isAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } }
