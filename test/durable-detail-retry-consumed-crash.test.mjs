import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';
import { reserveDetailSubmission, dispatchDetailSubmission, recordDetailId, markDetailUncertain, authorizeDetailObservationRetry } from '../dist/traversal.js';
import { resolveDurableRecoveryDebit, executeDurableDetail } from '../dist/durable-discovery.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
test('fresh process death at retry-consumed hook retains closed retry without invoking observation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'retry-consumed-')); const path = join(dir, 'state.db'); const ledger = join(dir, 'ledger');
  const stateUrl = new URL('../dist/durable-state.js', import.meta.url).href; const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
  try {
    let s = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 100 }); const cell = s.queue[0];
    s = reserveSubmission(admitNextCell(s), cell); s = { ...s, attempts: s.attempts.map(a => ({ ...a, status: 'dispatched', knownId: 'raw' })) }; s = observeKnownId(s, cell, 'raw', 0); s = applyDiscoveryResult(s, cell, { status: 'success', candidates: [{ id: 'one' }] });
    const work = s.detailWork[0]; s = reserveDetailSubmission(s, work.id); s = dispatchDetailSubmission(s, work.id); s = recordDetailId(s, work.id, 'known-detail'); s = markDetailUncertain(s, work.id); s = authorizeDetailObservationRetry(s, work.id, 1, 0);
    const d = DurableState.open(path); d.writeTraversal(s); writeFileSync(ledger, 'fixture: original detail send known-detail\n'); d.close();
    const child = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDetail,setDurableDetailBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDetailBoundaryHookForTest(x=>{if(x==='retry-consumed')process.exit(47)}); executeDurableDetail(d,${JSON.stringify(work.id)},id=>{fs.appendFileSync(${JSON.stringify(ledger)},'send:'+id+'\\n');throw Error('resend')},id=>{fs.appendFileSync(${JSON.stringify(ledger)},'observe:'+id+'\\n');return {elapsed:0}},{monotonicNow:()=>0});`;
    const died = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' }); assert.equal(died.status, 47, died.stderr);
    const ledgerAtHook = 'fixture: original detail send known-detail\n'; assert.equal(readFileSync(ledger, 'utf8'), ledgerAtHook);
    const raw = new DatabaseSync(path, { readOnly: true }); let crashed;
    try { crashed = JSON.parse(raw.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); } finally { raw.close(); }
    const item = crashed.detailWork.find(x => x.id === work.id); const attempt = item.attempts.at(-1);
    assert.equal(item.status, 'uncertain'); assert.equal(attempt.id, s.detailWork[0].attempts.at(-1).id); assert.equal(attempt.status, 'uncertain'); assert.equal(attempt.knownId, 'known-detail'); assert.equal(attempt.observationRetryOrdinal, 1); assert.equal(attempt.observationRetryCeiling, 1); assert.equal(attempt.observationRetryDisposition, 'closed'); assert.equal(attempt.observationRetryPendingDelayMs, undefined); assert.equal(crashed.submissions, 2); assert.equal(crashed.activeTime, s.activeTime); assert.deepEqual(crashed.detailGaps, s.detailGaps);
    let r = DurableState.open(path); assert.equal(r.readTraversal().recoveryPending, true); let sends = 0, observes = 0;
    assert.throws(() => executeDurableDetail(r, work.id, id => { sends++; fsAppend(ledger, 'send:' + id); return { id: 'bad' }; }, id => { observes++; fsAppend(ledger, 'observe:' + id); return { elapsed: 0 }; })); assert.equal(sends, 0); assert.equal(observes, 0); assert.equal(readFileSync(ledger, 'utf8'), ledgerAtHook);
    resolveDurableRecoveryDebit(r, 2, 'bounded synthetic crash debit'); r.close(); r = DurableState.open(path); const final = r.readTraversal();
    assert.equal(final.recoveryPending, false); assert.equal(final.activeTime, 2); assert.equal(final.submissions, 2); assert.deepEqual(final.detailGaps, s.detailGaps); assert.deepEqual(final.gaps, s.gaps);
    assert.equal(final.detailWork[0].attempts.at(-1).knownId, 'known-detail'); assert.equal(final.detailWork[0].attempts.at(-1).observationRetryOrdinal, 1); assert.equal(final.detailWork[0].attempts.at(-1).observationRetryCeiling, 1); assert.equal(final.detailWork[0].attempts.at(-1).observationRetryPendingDelayMs, undefined);
    assert.throws(() => authorizeDetailObservationRetry(final, work.id, 2, 0), /ceiling is immutable/i); assert.throws(() => authorizeDetailObservationRetry(final, work.id, 1, 0), /ceiling exhausted/i);
    assert.throws(() => executeDurableDetail(r, work.id, id => { sends++; fsAppend(ledger, 'send:' + id); return { id: 'bad' }; }, id => { observes++; fsAppend(ledger, 'observe:' + id); return { elapsed: 0 }; }), /closed/i); assert.equal(sends, 0); assert.equal(observes, 0); assert.equal(readFileSync(ledger, 'utf8'), ledgerAtHook); r.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
function fsAppend(path, text) { writeFileSync(path, text + '\n', { flag: 'a' }); }
