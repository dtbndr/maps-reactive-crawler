import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal, validateGeometry } from '../dist/index.js';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });

test('Slice C: discovery fans out A/B/C; detail recovery refuses unknown B and blocks C globally', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slice-c-detail-'));
  const path = join(dir, 'state.db');
  const ledger = join(dir, 'actual-sends.json');
  const discoveryEvidence = join(dir, 'discovery-observations.json');
  const stateUrl = new URL('../dist/durable-state.js', import.meta.url).href;
  const discoveryUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
  try {
    const state = DurableState.open(path);
    state.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 5, activeTime: 20 }));
    state.close(); writeFileSync(ledger, '[]');
    const child = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDiscovery,executeDurableDetail,setDurableDetailBoundaryHookForTest} from ${JSON.stringify(discoveryUrl)}; const d=DurableState.open(${JSON.stringify(path)}), l=${JSON.stringify(ledger)}; const send=w=>{const x=JSON.parse(fs.readFileSync(l));x.push(w);fs.writeFileSync(l,JSON.stringify(x));return{id:'discovery-id'}}; executeDurableDiscovery(d,send,()=>({elapsed:1,result:{status:'success',candidates:[{id:'A',verifiedCanonicalKey:'place:A'},{id:'B',verifiedCanonicalKey:'place:B'},{id:'C',verifiedCanonicalKey:'place:C'}]}}),'global',undefined,{monotonicNow:()=>0}); const discovered=d.readTraversal(); fs.writeFileSync(${JSON.stringify(discoveryEvidence)},JSON.stringify(discovered.candidates.map(x=>x.observationId))); const works=discovered.detailWork; if(works.length!==3) throw Error('expected three detail works'); executeDurableDetail(d,works[0].id,w=>{const x=JSON.parse(fs.readFileSync(l));x.push(w);fs.writeFileSync(l,JSON.stringify(x));return{id:'detail-A'}},()=>({elapsed:1}),{monotonicNow:()=>0}); setDurableDetailBoundaryHookForTest(x=>{if(x==='sent')process.exit(41)}); executeDurableDetail(d,works[1].id,w=>{const x=JSON.parse(fs.readFileSync(l));x.push(w);fs.writeFileSync(l,JSON.stringify(x));return{id:'detail-B'}},()=>({elapsed:1}),{monotonicNow:()=>0});`;
    const died = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
    assert.equal(died.status, 41, died.stderr);
    const firstLedger = JSON.parse(readFileSync(ledger));
    assert.deepEqual(firstLedger, ['work:0,0', 'detail:verified:place:A', 'detail:verified:place:B']);
    const observationIds = JSON.parse(readFileSync(discoveryEvidence));
    assert.equal(observationIds.length, 3);
    const rawDb = new DatabaseSync(path, { readOnly: true });
    const raw = JSON.parse(rawDb.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
    rawDb.close();
    assert.deepEqual(raw.detailWork.map(item => [item.id, item.status, item.attempts.map(attempt => attempt.knownId ?? null)]), [
      ['detail:verified:place:A', 'completed', ['detail-A']],
      ['detail:verified:place:B', 'dispatched', [null]],
      ['detail:verified:place:C', 'pending', []],
    ]);
    assert.deepEqual(raw.detailGaps, []);
    assert.deepEqual(raw.attempts.map(item => [item.id, item.status, item.knownId ?? null]), [['work:0,0:attempt:1', 'observed', 'discovery-id']]);
    assert.equal(raw.detailWork[1].observationIds[0], observationIds[1]);
    assert.equal(raw.submissions, 3); assert.equal(raw.activeTime, 0); assert.equal(raw.activeInterval, true);
    const resume = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(stateUrl)}; import {executeDurableDetail,resolveDurableRecoveryDebit} from ${JSON.stringify(discoveryUrl)}; const d=DurableState.open(${JSON.stringify(path)}), l=${JSON.stringify(ledger)}; const before=d.readTraversal(), ledgerBefore=fs.readFileSync(l,'utf8'); let callbacks=0; const send=x=>{callbacks++;fs.appendFileSync(l,JSON.stringify(x));throw Error('unexpected callback')}; try{executeDurableDetail(d,before.detailWork[2].id,send,()=>({elapsed:0}),{monotonicNow:()=>0});throw Error('expected accounting block')}catch(e){if(!/Recovery accounting is unresolved/.test(e.message))throw e} if(callbacks||fs.readFileSync(l,'utf8')!==ledgerBefore||JSON.stringify(d.readTraversal())!==JSON.stringify(before))throw Error('pre-debit attempt changed state or ledger'); resolveDurableRecoveryDebit(d,1,'bounded synthetic interruption'); const debited=d.readTraversal(); if(debited.recoveryPending||debited.activeTime!==1||debited.submissions!==before.submissions)throw Error('incorrect recovery debit'); try{executeDurableDetail(d,before.detailWork[1].id,send,()=>({elapsed:0}),{monotonicNow:()=>0});throw Error('expected B refusal')}catch(e){if(!/uncertain|refusing/i.test(e.message))throw e} const afterB=d.readTraversal(); if(afterB.detailWork[1].status!=='uncertain'||afterB.detailWork[1].attempts.at(-1).knownId)throw Error('B not uncertain'); try{executeDurableDetail(d,before.detailWork[2].id,send,()=>({elapsed:0}),{monotonicNow:()=>0});throw Error('expected global block')}catch(e){if(!/Global uncertainty blocks/.test(e.message))throw e} if(callbacks||fs.readFileSync(l,'utf8')!==ledgerBefore)throw Error('unexpected callback'); d.close();`;
    const resumed = spawnSync(process.execPath, ['--input-type=module', '-e', resume], { encoding: 'utf8' });
    assert.equal(resumed.status, 0, resumed.stderr);
    const finalState = DurableState.open(path); const snapshot = finalState.readTraversal(); finalState.close();
    assert.deepEqual(JSON.parse(readFileSync(ledger)), firstLedger);
    assert.deepEqual(firstLedger, ['work:0,0', 'detail:verified:place:A', 'detail:verified:place:B']);
    assert.deepEqual(snapshot.detailWork.map(x => x.status), ['completed', 'uncertain', 'pending']);
    assert.equal(snapshot.attempts[0].knownId, 'discovery-id');
    assert.deepEqual(snapshot.detailWork.map(item => item.attempts.map(attempt => attempt.knownId ?? null)), [['detail-A'], [null], []]);
    assert.equal(snapshot.submissions, 3); assert.equal(snapshot.activeTime, 1); assert.equal(snapshot.recoveryPending, false);
    assert.deepEqual(snapshot.detailWork.map(item => [item.id, item.attempts.map(attempt => attempt.id)]), [
      ['detail:verified:place:A', ['detail:verified:place:A:attempt:1']],
      ['detail:verified:place:B', ['detail:verified:place:B:attempt:1']],
      ['detail:verified:place:C', []],
    ]);
    assert.deepEqual(snapshot.detailGaps, [
      { workId: 'detail:verified:place:B', identity: 'verified:place:B', observationIds: [observationIds[1]], status: 'unresolved' },
    ]);
    assert.deepEqual(snapshot.recoveryDebitEvidence, { elapsed: 1, evidence: 'bounded synthetic interruption' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
