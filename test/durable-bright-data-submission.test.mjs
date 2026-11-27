import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { submitDurableBrightData } from '../dist/durable-bright-data-submission.js';

const binding = { version: 2, mode: 'bright-data', keyword: 'pizza', country: 'GB', zoom: 14, limitPerInput: 10 };
const bounds = () => ({ requestMilliseconds: 1000, activeUntil: Date.now() + 10000 });
test('durable provider submission persists dispatch before transport and acknowledged ID afterward; binding mismatch sends nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'durable-provider-')); const path = join(dir, 'state.db');
  let calls = 0;
  try {
    DurableState.createBound(path, binding, createTraversal({ seed: { latitude: 51, longitude: -1 }, spacing: 1000, area: { type: 'radius', radius: 2000 } }, { cells: 5, submissions: 5, activeTime: 10000 }));
    const transport = { async submit(request) {
      calls++;
      const db = new DatabaseSync(path, { readOnly: true });
      try { const checkpoint = JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); assert.equal(checkpoint.attempts.at(-1).status, 'dispatched'); } finally { db.close(); }
      assert.equal(request.body.input[0].keyword, 'pizza'); assert.equal(request.body.input[0].lat, 51);
      return { status: 202, body: { snapshot_id: 'synthetic-id' } };
    } };
    assert.throws(() => DurableState.openBound(path, { ...binding, keyword: 'other' }), /match/);
    assert.equal(calls, 0);
    const state = DurableState.openBound(path, binding);
    try {
      await submitDurableBrightData(state, transport, bounds());
      assert.equal(calls, 1);
      assert.equal(state.readTraversal().attempts.at(-1).knownId, 'synthetic-id');
    } finally { state.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
