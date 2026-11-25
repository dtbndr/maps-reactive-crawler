import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';
import { executeDurableDetail, resolveDurableRecoveryDebit } from '../dist/durable-discovery.js';
import { reserveDetailSubmission, dispatchDetailSubmission, recordDetailId, authorizeDetailObservationRetry, markDetailUncertain } from '../dist/traversal.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });

test('actual SQLite detail executor reads throwing elapsed getter once and closes observation', () => {
  for (const recovered of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'detail-elapsed-')); const path = join(dir, 'state.db');
    let db;
    try {
      let state = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 100 }); const cell = state.queue[0];
      state = reserveSubmission(admitNextCell(state), cell); state = { ...state, attempts: state.attempts.map(a => ({ ...a, status: 'dispatched', knownId: 'raw' })) };
      state = observeKnownId(state, cell, 'raw', 0); state = applyDiscoveryResult(state, cell, { status: 'success', candidates: [{ id: 'one' }] });
      const work = state.detailWork[0];
      if (recovered) { state = reserveDetailSubmission(state, work.id); state = dispatchDetailSubmission(state, work.id); state = recordDetailId(state, work.id, 'detail-id'); state = markDetailUncertain(state, work.id); }
      db = DurableState.open(path); db.writeTraversal(state); if (recovered) { db.close(); db = DurableState.open(path); }
      let reads = 0, sends = 0, polls = 0; const ledger = [];
      const result = () => Object.defineProperty({}, 'elapsed', { get() { reads++; throw Error('unreadable elapsed'); } });
      assert.throws(() => executeDurableDetail(db, work.id, () => { ledger.push('send:detail-id'); sends++; return { id: 'detail-id' }; }, id => { ledger.push(`observe:${id}`); polls++; return result(); }, { monotonicNow: () => 0 }, { observationCeiling: 0, knownSafeObservationError: () => false }), /Invalid detail observation time/);
      assert.equal(reads, 1); assert.equal(polls, 1); assert.equal(sends, recovered ? 0 : 1);
      assert.deepEqual(ledger, recovered ? ['observe:detail-id'] : ['send:detail-id', 'observe:detail-id']);
      const final = db.readTraversal(); const attempt = final.detailWork[0].attempts.at(-1);
      assert.equal(attempt.knownId, 'detail-id'); assert.equal(attempt.observationRetryDisposition, 'closed');
      assert.equal(final.detailWork[0].status, 'uncertain');
      assert.deepEqual(final.detailGaps, [{ workId: work.id, identity: work.identity, observationIds: [...work.observationIds], status: 'unresolved' }]);
      db.close(); db = DurableState.open(path); let again = 0;
      assert.throws(() => executeDurableDetail(db, work.id, () => { ledger.push('unexpected-send'); sends++; return { id: 'resend' }; }, id => { ledger.push(`unexpected-observe:${id}`); again++; return { elapsed: 0 }; }, { monotonicNow: () => 0 }));
      assert.equal(sends, recovered ? 0 : 1); assert.equal(again, 0); assert.deepEqual(ledger, recovered ? ['observe:detail-id'] : ['send:detail-id', 'observe:detail-id']);
    } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test('detail elapsed getter is sampled only once when its value changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detail-elapsed-changing-')); const db = DurableState.open(join(dir, 'state.db'));
  try {
    let state = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 100 }); const cell = state.queue[0];
    state = reserveSubmission(admitNextCell(state), cell); state = { ...state, attempts: state.attempts.map(a => ({ ...a, status: 'dispatched', knownId: 'raw' })) };
    state = observeKnownId(state, cell, 'raw', 0); state = applyDiscoveryResult(state, cell, { status: 'success', candidates: [{ id: 'one' }] });
    const work = state.detailWork[0]; db.writeTraversal(state); let reads = 0;
    executeDurableDetail(db, work.id, () => ({ id: 'detail-id' }), () => ({ get elapsed() { return ++reads === 1 ? 0 : NaN; } }), { monotonicNow: () => 0 });
    assert.equal(reads, 1); assert.equal(db.readTraversal().detailWork[0].status, 'completed');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('fresh-process death after consuming detail observation retry closes it without resend', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detail-retry-crash-')); const path = join(dir, 'state.db'); const ledger = join(dir, 'ledger');
  const executor = new URL('../dist/durable-discovery.js', import.meta.url).href;
  try {
    let s = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 100 }); const cell = s.queue[0];
    s = reserveSubmission(admitNextCell(s), cell); s = { ...s, attempts: s.attempts.map(a => ({ ...a, status: 'dispatched', knownId: 'raw' })) };
    s = observeKnownId(s, cell, 'raw', 0); s = applyDiscoveryResult(s, cell, { status: 'success', candidates: [{ id: 'one' }] });
    const work = s.detailWork[0]; s = reserveDetailSubmission(s, work.id); s = dispatchDetailSubmission(s, work.id); s = recordDetailId(s, work.id, 'detail-id'); s = markDetailUncertain(s, work.id); s = authorizeDetailObservationRetry(s, work.id, 1, 0);
    const d = DurableState.open(path); d.writeTraversal(s); writeFileSync(ledger, 'fixture: original detail send detail-id\n'); d.close();
    const child = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(new URL('../dist/durable-state.js', import.meta.url).href)}; import {executeDurableDetail} from ${JSON.stringify(executor)}; const d=DurableState.open(${JSON.stringify(path)}); executeDurableDetail(d,${JSON.stringify(work.id)},id=>{fs.appendFileSync(${JSON.stringify(ledger)},'send:'+id+'\\n');throw Error('unexpected resend')},id=>{fs.appendFileSync(${JSON.stringify(ledger)},'observe:'+id+'\\n');process.exit(43);return {elapsed:0}},{monotonicNow:()=>0});`;
    const died = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' }); assert.equal(died.status, 43, died.stderr);
    const raw = new DatabaseSync(path, { readOnly: true });
    try { const p = JSON.parse(raw.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); const item = p.detailWork.find(x => x.id === work.id); const a = item.attempts.at(-1); assert.equal(item.status, 'uncertain'); assert.equal(a.id, s.detailWork[0].attempts.at(-1).id); assert.equal(a.status, 'uncertain'); assert.equal(a.knownId, 'detail-id'); assert.equal(a.observationRetryCeiling, 1); assert.equal(p.submissions, 2); assert.equal(p.activeTime, s.activeTime); assert.deepEqual(p.detailGaps, s.detailGaps); assert.deepEqual(p.gaps, s.gaps); assert.equal(a.observationRetryDisposition, 'closed'); assert.equal(a.observationRetryPendingDelayMs, undefined); assert.equal(a.observationRetryOrdinal, 1); } finally { raw.close(); }
    const ledgerAfterDeath = 'fixture: original detail send detail-id\nobserve:detail-id\n';
    assert.equal(readFileSync(ledger, 'utf8'), ledgerAfterDeath);
    let r = DurableState.open(path); assert.equal(r.readTraversal().recoveryPending, true);
    let sends = 0, polls = 0; assert.throws(() => executeDurableDetail(r, work.id, id => { sends++; writeFileSync(ledger, `send:${id}\\n`, { flag: 'a' }); return { id: 'bad' }; }, id => { polls++; writeFileSync(ledger, `observe:${id}\\n`, { flag: 'a' }); return { elapsed: 0 }; })); assert.equal(sends, 0); assert.equal(polls, 0); assert.equal(readFileSync(ledger, 'utf8'), ledgerAfterDeath);
    resolveDurableRecoveryDebit(r, 2, 'synthetic bounded crash debit'); r.close(); r = DurableState.open(path); const final = r.readTraversal();
    assert.equal(final.recoveryPending, false); assert.equal(final.activeTime, 2); assert.equal(final.submissions, 2); assert.equal(final.detailWork[0].status, 'uncertain'); assert.equal(final.detailWork[0].id, work.id); assert.equal(final.detailWork[0].attempts.at(-1).knownId, 'detail-id'); assert.equal(final.detailWork[0].attempts.at(-1).observationRetryOrdinal, 1); assert.equal(final.detailWork[0].attempts.at(-1).observationRetryCeiling, 1); assert.equal(final.detailWork[0].attempts.at(-1).status, 'uncertain'); assert.equal(final.detailWork[0].attempts.at(-1).observationRetryDisposition, 'closed'); assert.deepEqual(final.detailGaps, s.detailGaps);
    assert.throws(() => authorizeDetailObservationRetry(final, work.id, 2, 0), /ceiling is immutable/i); assert.throws(() => authorizeDetailObservationRetry(final, work.id, 1, 0), /ceiling exhausted/i);
    assert.throws(() => executeDurableDetail(r, work.id, id => { sends++; writeFileSync(ledger, `send:${id}\\n`, { flag: 'a' }); return { id: 'bad' }; }, id => { polls++; writeFileSync(ledger, `observe:${id}\\n`, { flag: 'a' }); return { elapsed: 0 }; }), /closed/i); assert.equal(sends, 0); assert.equal(polls, 0); assert.equal(readFileSync(ledger, 'utf8'), ledgerAfterDeath); r.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
