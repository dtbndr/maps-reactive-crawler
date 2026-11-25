import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DurableState } from '../dist/durable-state.js';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
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
    const d = DurableState.open(path); d.writeTraversal(base); d.close(); writeFileSync(ledger, '{}');
    const child = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDetail,setDurableDetailBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDetailBoundaryHookForTest(x=>{if(x==='id-persisted')process.exit(41)}); executeDurableDetail(d,d.readTraversal().detailWork[0].id,w=>{const l=JSON.parse(fs.readFileSync(${JSON.stringify(ledger)}));l[w]='detail-1';fs.writeFileSync(${JSON.stringify(ledger)},JSON.stringify(l));return {id:'detail-1'}},()=>({elapsed:0}),{monotonicNow:()=>0});`;
    const died = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
    assert.equal(died.status, 41, died.stderr);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledger))), [base.detailWork[0].id]);
    const resume = `import {DurableState} from ${JSON.stringify(stateUrl)}; import {resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; import {executeDurableDetail} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); resolveDurableRecoveryDebit(d,2,'synthetic conservative debit'); let sends=0, seen=''; const s=executeDurableDetail(d,d.readTraversal().detailWork[0].id,()=>{sends++;throw Error('resend')},id=>{seen=id;return {elapsed:1}},{monotonicNow:()=>0}); if(sends!==0||seen!=='detail-1'||s.submissions!==2||s.activeTime!==2||s.detailWork[0].status!=='completed') throw Error(JSON.stringify({sends,seen,s})); d.close();`;
    const resumed = spawnSync(process.execPath, ['--input-type=module', '-e', resume], { encoding: 'utf8' }); assert.equal(resumed.status, 0, resumed.stderr);
    const final = DurableState.open(path).readTraversal();
    assert.equal(final.detailWork[0].attempts[0].knownId, 'detail-1'); assert.equal(final.submissions, 2); assert.equal(final.activeTime, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
