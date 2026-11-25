import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal, validateGeometry } from '../dist/index.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
test('Slice B: fresh-process active-interval recovery blocks before debit then dispatches queued B once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slice-b-'));
  const path = join(dir, 'state.db');
  const ledgerPath = join(dir, 'actual-sends.json');
  const durableUrl = new URL('../dist/durable-state.js', import.meta.url).href;
  const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
  try {
    const state = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
    const withQueuedB = { ...initial, queue: ['0,0', '0,1'], admitted: [...initial.admitted, '0,1'], cells: { ...initial.cells, '0,1': { outcome: 'queued' } } };
    state.writeTraversal(withQueuedB);
    state.close();
    writeFileSync(ledgerPath, '{}');
    const childScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='committed') process.exit(41)}); executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(${JSON.stringify(ledgerPath)})); if(l[w]) throw Error('duplicate'); l[w]='job-A'; fs.writeFileSync(${JSON.stringify(ledgerPath)},JSON.stringify(l)); return {id:'job-A'}},()=>({elapsed:1,result:{status:'success',candidates:[{id:'A',coordinate:null}]}}),'isolated',undefined,{monotonicNow:()=>0});`;
    const died = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], { encoding: 'utf8' });
    assert.equal(died.status, 41, died.stderr);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath)), { 'work:0,0': 'job-A' });
    let recovered = DurableState.open(path); let snapshot = recovered.readTraversal(); recovered.close();
    assert.equal(snapshot.recoveryPending, true); assert.equal(snapshot.cells['0,0'].outcome, 'nonempty'); assert.deepEqual(snapshot.queue, ['0,1', '0,-1', '1,0', '-1,0']);
    const recoveryUrl = executorUrl;
    const script = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(recoveryUrl)}; const p=${JSON.stringify(path)}, l=${JSON.stringify(ledgerPath)}, d=DurableState.open(p); let sends=0; try { executeDurableDiscovery(d,()=>{sends++;throw Error('send before debit')},()=>({elapsed:0,result:{status:'empty'}}),'isolated',undefined,{monotonicNow:()=>0}); process.exit(42) } catch(e) { if(!/Recovery accounting is unresolved/.test(e.message)) throw e } if(sends) throw Error('unexpected send'); const before=d.readTraversal(); if(JSON.stringify(before.queue)!==JSON.stringify(['0,1','0,-1','1,0','-1,0'])) throw Error('B queue changed'); resolveDurableRecoveryDebit(d,2,'verified synthetic provider interval evidence'); const afterDebit=d.readTraversal(); if(afterDebit.activeTime!==2||afterDebit.recoveryPending) throw Error('debit incorrect'); executeDurableDiscovery(d,w=>{const ledger=JSON.parse(fs.readFileSync(l)); if(ledger[w]) throw Error('duplicate '+w); ledger[w]='job-B'; fs.writeFileSync(l,JSON.stringify(ledger)); sends++; return {id:'job-B'}},id=>({elapsed:1,result:{status:'empty'}}),'isolated',undefined,{monotonicNow:()=>0}); if(sends!==1) throw Error('B dispatch count'); d.close();`;
    const resumed = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(resumed.status, 0, resumed.stderr);
    recovered = DurableState.open(path); snapshot = recovered.readTraversal(); recovered.close();
    assert.equal(snapshot.cells['0,0'].outcome, 'nonempty'); assert.equal(snapshot.attempts[0].knownId, 'job-A'); assert.equal(snapshot.activeTime, 2); assert.equal(snapshot.limits.activeTime, 10); assert.equal(snapshot.submissions, 2); assert.deepEqual(JSON.parse(readFileSync(ledgerPath)), { 'work:0,0': 'job-A', 'work:0,1': 'job-B' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
