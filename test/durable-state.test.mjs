import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';

test('durable state persists atomic transitions and can be reopened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crawler-state-'));
  const path = join(dir, 'state.db');
  try {
    const state = DurableState.open(path);
    assert.deepEqual(state.read(), { version: 1, work: [], observations: [], gaps: [] });
    state.transition(s => ({ ...s, work: [{ id: 'work-1', status: 'pending' }] }));
    state.close();
    assert.equal(DurableState.open(path).read().work[0].status, 'pending');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejects unsupported schema and competing ownership', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crawler-state-'));
  const path = join(dir, 'state.db');
  try {
    const owner = DurableState.open(path);
    assert.throws(() => DurableState.open(path), /owned/);
    owner.close();
    const reopened = DurableState.open(path);
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
