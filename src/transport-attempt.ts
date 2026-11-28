import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const intervalMs = 1100;
const lockWaitMs = 5000;

// Internal only: each individual transport attempt, including retries, must use this boundary.
export async function coordinateTransportAttempt<T>(directory: string, attempt: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, 'attempt.lock');
  const timing = join(directory, 'attempt-time.json');
  const deadline = performance.now() + lockWaitMs;
  for (;;) {
    try { await mkdir(lock, { mode: 0o700 }); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (performance.now() >= deadline) throw new Error('Transport attempt lock is held; manual recovery may be required');
      await sleep(25);
    }
  }
  let safeToRelease = true;
  try {
    let previous = 0;
    try {
      const value: unknown = JSON.parse(await readFile(timing, 'utf8'));
      if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('wallTime' in value) || typeof value.wallTime !== 'number' || !Number.isSafeInteger(value.wallTime) || value.wallTime < 0) throw new Error('Invalid transport attempt timing');
      previous = value.wallTime;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const record = async () => {
      const now = Date.now();
      if (!Number.isSafeInteger(now) || now < previous) throw new Error('Transport attempt wall clock regression');
      previous = now;
      await writeFile(timing, JSON.stringify({ wallTime: now }), { mode: 0o600 });
    };
    // Keep ownership on a failed timing write: the persisted state may be incomplete.
    const safeRecord = async () => {
      safeToRelease = false;
      await record();
      safeToRelease = true;
    };
    await safeRecord();
    const acquired = performance.now();
    while (performance.now() - acquired < intervalMs) await sleep(Math.ceil(intervalMs - (performance.now() - acquired)));
    await safeRecord();
    try { return await attempt(); } finally { await safeRecord(); }
  } finally {
    if (safeToRelease) await rm(lock, { recursive: true });
  }
}
