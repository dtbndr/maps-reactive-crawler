import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
test('fresh-process detail recovery marks reserved and dispatched no-ID crashes uncertain without resend', () => {
  for (const boundary of ['reserved', 'sent']) {
    const dir = mkdtempSync(join(tmpdir(), 'detail-no-id-'));
    const path = join(dir, 'state.db'); const ledger = join(dir, 'sends.json');
    const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
    const stateUrl = new URL('../dist/durable-state.js', import.meta.url).href;
    try {
      let base = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
      const key = base.queue[0]; base = reserveSubmission(admitNextCell(base), key);
      base = { ...base, attempts: base.attempts.map(a => ({ ...a, status: 'dispatched', knownId: 'raw' })) };
      base = observeKnownId(base, key, 'raw', 0);
      base = applyDiscoveryResult(base, key, { status: 'success', candidates: [{ id: 'one' }] });
      const d = DurableState.open(path); d.writeTraversal(base); d.close(); writeFileSync(ledger, '');
      const child = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDetail,setDurableDetailBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDetailBoundaryHookForTest(x=>{if(x===${JSON.stringify(boundary)})process.exit(41)}); executeDurableDetail(d,d.readTraversal().detailWork[0].id,w=>{fs.appendFileSync(${JSON.stringify(ledger)},w+'\\n');return{id:'never-returned'}},()=>({elapsed:0}),{monotonicNow:()=>0});`;
      const died = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
      assert.equal(died.status, 41, died.stderr);
      const raw = new DatabaseSync(path, { readOnly: true });
      try {
        const payload = JSON.parse(raw.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
        assert.equal(payload.activeInterval, true);
        assert.equal(payload.detailWork[0].status, boundary === 'sent' ? 'dispatched' : boundary);
        assert.equal(payload.detailWork[0].attempts.at(-1).status, boundary === 'sent' ? 'dispatched' : boundary);
        assert.equal(payload.detailWork[0].attempts.at(-1).knownId, undefined);
      } finally { raw.close(); }
      assert.equal(readFileSync(ledger, 'utf8'), boundary === 'sent' ? `${base.detailWork[0].id}\n` : '');
      const restart = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDetail,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); let sends=0; const w=d.readTraversal().detailWork[0]; try{executeDurableDetail(d,w.id,x=>{sends++;fs.appendFileSync(${JSON.stringify(ledger)},x+'\\n');return{id:'duplicate'}},()=>({elapsed:0}))}catch{} const pending=d.readTraversal(); if(pending.recoveryPending!==true||sends!==0)throw Error(JSON.stringify(pending)); resolveDurableRecoveryDebit(d,2,'uncertain detail send'); const after=d.readTraversal(); if(after.recoveryPending||after.submissions!==2)throw Error(JSON.stringify(after)); try{executeDurableDetail(d,w.id,x=>{sends++;fs.appendFileSync(${JSON.stringify(ledger)},x+'\\n');return{id:'bad'}},()=>({elapsed:0}))}catch{} const parked=d.readTraversal(); if(sends!==0||parked.detailWork[0].status!=='uncertain'||!parked.detailGaps?.length)throw Error(JSON.stringify(parked)); d.close();`;
      const resumed = spawnSync(process.execPath, ['--input-type=module', '-e', restart], { encoding: 'utf8' });
      assert.equal(resumed.status, 0, resumed.stderr);
      assert.equal(readFileSync(ledger, 'utf8'), boundary === 'sent' ? `${base.detailWork[0].id}\n` : '');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('fresh-process detail recovery observes persisted ID without resending after crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'detail-crash-'));
  const path = join(dir, 'state.db'); const ledger = join(dir, 'sends.json');
  const stateUrl = new URL('../dist/durable-state.js', import.meta.url).href;
  const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
  try {
    let base = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
    const key = base.queue[0]; base = reserveSubmission(admitNextCell(base), key);
    base = { ...base, attempts: base.attempts.map(a => ({ ...a, status: 'dispatched', knownId: 'raw' })) };
    base = observeKnownId(base, key, 'raw', 0);
    base = applyDiscoveryResult(base, key, { status: 'success', candidates: [{ id: 'one' }] });
    const d = DurableState.open(path); d.writeTraversal(base); d.close(); writeFileSync(ledger, '');
    const child = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDetail,setDurableDetailBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDetailBoundaryHookForTest(x=>{if(x==='id-persisted')process.exit(41)}); executeDurableDetail(d,d.readTraversal().detailWork[0].id,w=>{fs.appendFileSync(${JSON.stringify(ledger)},w+'\\n');return {id:'detail-1'}},()=>({elapsed:0}),{monotonicNow:()=>0});`;
    const died = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
    assert.equal(died.status, 41, died.stderr);
    const rawDb = new DatabaseSync(path, { readOnly: true });
    try {
      const payload = JSON.parse(rawDb.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
      assert.equal(payload.activeInterval, true);
      assert.equal(payload.detailWork[0].id, base.detailWork[0].id);
      assert.equal(payload.detailWork[0].attempts[0].status, 'dispatched');
      assert.equal(payload.detailWork[0].attempts[0].knownId, 'detail-1');
    } finally { rawDb.close(); }
    const resume = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; import {executeDurableDetail} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); let sends=0,polls=0; const work=d.readTraversal().detailWork[0]; const before=d.readTraversal(); if(before.recoveryPending!==true||before.activeInterval!==false||before.submissions!==2||before.detailWork[0].attempts[0].status!=='dispatched'||before.detailWork[0].attempts[0].knownId!=='detail-1') throw Error(JSON.stringify({recoveryPending:before.recoveryPending,activeInterval:before.activeInterval,submissions:before.submissions,attempts:before.detailWork[0].attempts})); try { executeDurableDetail(d,work.id,w=>{sends++;fs.appendFileSync(${JSON.stringify(ledger)},w+'\\n');return{id:'duplicate'}},()=>{polls++;return{elapsed:1}}); throw Error('execution unexpectedly accepted before debit'); } catch(e) { if(e.message==='execution unexpectedly accepted before debit') throw e; } if(sends!==0||polls!==0) throw Error(JSON.stringify({sends,polls})); resolveDurableRecoveryDebit(d,2,'synthetic conservative debit'); const debited=d.readTraversal(); if(debited.recoveryPending!==false||debited.activeInterval!==false||debited.activeTime!==2||debited.submissions!==2) throw Error(JSON.stringify(debited)); const s=executeDurableDetail(d,work.id,w=>{sends++;fs.appendFileSync(${JSON.stringify(ledger)},w+'\\n');throw Error('resend')},id=>{polls++;if(id!=='detail-1') throw Error('unexpected poll ID '+id);return{elapsed:1}},{monotonicNow:()=>0}); if(sends!==0||polls!==1||s.submissions!==2||s.activeTime!==2||s.recoveryPending!==false||s.activeInterval!==false||s.detailWork[0].status!=='completed') throw Error(JSON.stringify({sends,polls,s})); d.close();`;
    const resumed = spawnSync(process.execPath, ['--input-type=module', '-e', resume], { encoding: 'utf8' }); assert.equal(resumed.status, 0, resumed.stderr);
    const finalState = DurableState.open(path);
    const final = finalState.readTraversal();
    assert.equal(final.detailWork[0].attempts[0].knownId, 'detail-1'); assert.equal(final.submissions, 2); assert.equal(final.activeTime, 2);
    assert.equal(final.detailWork[0].status, 'completed');
    assert.equal(final.recoveryPending, false); assert.equal(final.activeInterval, false);
    assert.deepEqual(final.gaps, base.gaps); assert.deepEqual(final.detailGaps ?? [], base.detailGaps ?? []);
    assert.deepEqual(readFileSync(ledger, 'utf8').trim().split('\\n'), [base.detailWork[0].id]);
    finalState.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
