import test from 'node:test'; import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs'; import { DatabaseSync } from 'node:sqlite'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawnSync } from 'node:child_process';
import { validateGeometry, createTraversal } from '../dist/index.js'; import { DurableState } from '../dist/durable-state.js'; import { executeDurableDiscovery, resolveDurableRecoveryDebit, recordDurableCleanPause } from '../dist/durable-discovery.js';
const geo=validateGeometry({seed:{latitude:0,longitude:0},spacing:10,area:{type:'bbox',south:-1,north:1,west:-1,east:1}});
test('fresh process fails closed after crash; finite debit resolves; invalid and posthoc clean pause reject',()=>{
 const dir=mkdtempSync(join(tmpdir(),'recovery-time-'));const path=join(dir,'state.db');
 try {
  const init=`import {DurableState} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';const d=DurableState.open(${JSON.stringify(path)});d.writeTraversal(createTraversal(${JSON.stringify(geo)},{cells:1,submissions:1,activeTime:10}));process.exit(0)`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',init],{encoding:'utf8'}).status,0);
  const state=DurableState.open(path);assert.equal(state.readTraversal().recoveryPending,true);
  assert.throws(()=>executeDurableDiscovery(state,()=>({id:'bad'}),()=>({result:{status:'empty'},elapsed:1})));
  assert.throws(()=>resolveDurableRecoveryDebit(state,-1,'bad'));assert.throws(()=>recordDurableCleanPause(state,'after crash'));
  resolveDurableRecoveryDebit(state,2,'bounded conservative interval');assert.equal(state.readTraversal().activeTime,2);assert.equal(state.readTraversal().recoveryPending,false);state.close();
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('malformed clean-pause marker after abrupt death fails closed without sending',()=>{
 const dir=mkdtempSync(join(tmpdir(),'malformed-clean-pause-'));const path=join(dir,'state.db');
 try {
  const child=`import {DurableState} from './dist/durable-state.js';import {DatabaseSync} from 'node:sqlite';import {createTraversal} from './dist/traversal.js';const d=DurableState.open(${JSON.stringify(path)});d.writeTraversal(createTraversal(${JSON.stringify(geo)},{cells:1,submissions:1,activeTime:10}));const raw=new DatabaseSync(${JSON.stringify(path)});raw.prepare('UPDATE traversal SET payload=?').run(JSON.stringify({...d.readTraversal(),cleanPauseEvidence:{}}));raw.close();process.exit(0)`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8'}).status,0);
  assert.throws(()=>DurableState.open(path),/Corrupt traversal checkpoint/);
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('valid clean pause before abrupt death does not demand debit',()=>{
 const dir=mkdtempSync(join(tmpdir(),'clean-pause-crash-'));const path=join(dir,'state.db');
 try {
  const child=`import {DurableState} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';import {recordDurableCleanPause} from './dist/durable-discovery.js';const d=DurableState.open(${JSON.stringify(path)});d.writeTraversal(createTraversal(${JSON.stringify(geo)},{cells:1,submissions:1,activeTime:10}));recordDurableCleanPause(d,'operator paused before exit');process.exit(0)`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8'}).status,0);
  const reopened=DurableState.open(path);const state=reopened.readTraversal();assert.equal(state.recoveryPending,false);assert.equal(state.paused,true);assert.equal(state.cleanPauseEvidence.evidence,'operator paused before exit');reopened.close();
 } finally {rmSync(dir,{recursive:true,force:true})}
});

test('overflowing recovery debit preserves pending snapshot',()=>{const dir=mkdtempSync(join(tmpdir(),'debit-overflow-'));const d=DurableState.open(join(dir,'state.db'));try{d.writeTraversal({...createTraversal(geo,{cells:1,submissions:1,activeTime:10}),activeTime:Number.MAX_VALUE,recoveryPending:true});const before=d.readTraversal();assert.throws(()=>resolveDurableRecoveryDebit(d,Number.MAX_VALUE,'synthetic bound'));assert.deepEqual(d.readTraversal(),before)}finally{d.close();rmSync(dir,{recursive:true,force:true})}});
