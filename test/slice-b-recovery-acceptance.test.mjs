import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal, validateGeometry } from '../dist/index.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });

test('Slice C: discovery fans out A/B/C; detail recovery refuses unknown B and blocks C globally', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slice-c-detail-'));
  const path = join(dir, 'state.db');
  const ledger = join(dir, 'actual-sends.json');
  const stateUrl = new URL('../dist/durable-state.js', import.meta.url).href;
  const discoveryUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
  try {
    const state = DurableState.open(path);
    state.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 5, activeTime: 20 }));
    state.close(); writeFileSync(ledger, '[]');
    const child = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDiscovery,executeDurableDetail,setDurableDetailBoundaryHookForTest} from ${JSON.stringify(discoveryUrl)}; const d=DurableState.open(${JSON.stringify(path)}), l=${JSON.stringify(ledger)}; const send=w=>{const x=JSON.parse(fs.readFileSync(l));x.push(w);fs.writeFileSync(l,JSON.stringify(x));return{id:'discovery-id'}}; executeDurableDiscovery(d,send,()=>({elapsed:1,result:{status:'success',candidates:[{id:'A',verifiedCanonicalKey:'place:A'},{id:'B',verifiedCanonicalKey:'place:B'},{id:'C',verifiedCanonicalKey:'place:C'}]}}),'global',undefined,{monotonicNow:()=>0}); const works=d.readTraversal().detailWork; if(works.length!==3) throw Error('expected three detail works'); executeDurableDetail(d,works[0].id,w=>{const x=JSON.parse(fs.readFileSync(l));x.push(w);fs.writeFileSync(l,JSON.stringify(x));return{id:'detail-A'}},()=>({elapsed:1}),{monotonicNow:()=>0}); setDurableDetailBoundaryHookForTest(x=>{if(x==='sent')process.exit(41)}); executeDurableDetail(d,works[1].id,w=>{const x=JSON.parse(fs.readFileSync(l));x.push(w);fs.writeFileSync(l,JSON.stringify(x));return{id:'detail-B'}},()=>({elapsed:1}),{monotonicNow:()=>0});`;
    const died = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
    assert.equal(died.status, 41, died.stderr);
    const firstLedger = JSON.parse(readFileSync(ledger));
    assert.equal(firstLedger.length, 3); // discovery followed by A then B; C was never sent
    const resume = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDetail,resolveDurableRecoveryDebit} from ${JSON.stringify(discoveryUrl)}; const d=DurableState.open(${JSON.stringify(path)}); resolveDurableRecoveryDebit(d,1,'bounded synthetic interruption'); const s=d.readTraversal(), w=s.detailWork; if(w[1].attempts.at(-1).knownId) throw Error('B unexpectedly has ID'); try{executeDurableDetail(d,w[1].id,x=>{fs.appendFileSync(${JSON.stringify(ledger)},JSON.stringify(x));throw Error('must refuse')},()=>({elapsed:0}),{monotonicNow:()=>0});throw Error('expected refusal')}catch(e){if(!/uncertain|refusing/i.test(e.message))throw e} try{executeDurableDetail(d,w[2].id,x=>{fs.appendFileSync(${JSON.stringify(ledger)},JSON.stringify(x));throw Error('C sent')},()=>({elapsed:0}),{monotonicNow:()=>0});throw Error('expected global block')}catch(e){if(!/Global uncertainty blocks/.test(e.message))throw e} d.close();`;
    const resumed = spawnSync(process.execPath, ['--input-type=module', '-e', resume], { encoding: 'utf8' });
    assert.equal(resumed.status, 0, resumed.stderr);
    const finalState = DurableState.open(path); const snapshot = finalState.readTraversal(); finalState.close();
    assert.deepEqual(JSON.parse(readFileSync(ledger)), firstLedger);
    assert.deepEqual(firstLedger, ['work:0,0', 'detail:verified:place:A', 'detail:verified:place:B']);
    assert.deepEqual(snapshot.detailWork.map(x => x.status), ['completed', 'uncertain', 'pending']);
    assert.equal(snapshot.submissions, 3); assert.equal(snapshot.activeTime, 1);
    assert.ok(snapshot.detailGaps?.length || snapshot.gaps?.length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
