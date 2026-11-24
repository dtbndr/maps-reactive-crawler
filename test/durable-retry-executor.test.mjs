import test from 'node:test'; import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, dispatchSubmission, markUncertain } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js'; import { executeDurableDiscovery } from '../dist/durable-discovery.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawnSync } from 'node:child_process';
const geo=validateGeometry({seed:{latitude:0,longitude:0},spacing:10,area:{type:'bbox',south:-1,north:1,west:-1,east:1}});
test('executor retries known ID safely and persists ordinal without spending a submission across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-')); const path=join(dir,'state.db'); let sends=0, polls=0;
 try { let db=DurableState.open(path); let s=createTraversal(geo,{cells:1,submissions:1,activeTime:10}); s=admitNextCell(s); s=reserveSubmission(s,'0,0'); s=dispatchSubmission(s,'0,0'); s=markUncertain(s,'0,0','isolated','id-1'); db.writeTraversal(s); db.close();
 db=DurableState.open(path); executeDurableDiscovery(db,()=>{sends++;return{id:'bad'}},()=>{polls++;if(polls===1)throw Error('known-safe');return{result:{status:'empty'},elapsed:1}},'isolated',{observationCeiling:1,knownSafeObservationError:e=>e.message==='known-safe'});
 assert.equal(sends,0); assert.equal(db.readTraversal().submissions,1); assert.equal(db.readTraversal().attempts[0].retryOrdinal,1); db.close();
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('unsafe observation error is not retried',()=>{const dir=mkdtempSync(join(tmpdir(),'retry-'));const db=DurableState.open(join(dir,'state.db'));let s=createTraversal(geo,{cells:1,submissions:1,activeTime:10});s=admitNextCell(s);s=reserveSubmission(s,'0,0');s=dispatchSubmission(s,'0,0');s=markUncertain(s,'0,0','isolated','id');db.writeTraversal(s);let calls=0;assert.throws(()=>executeDurableDiscovery(db,()=>({id:'x'}),()=>{calls++;throw Error('unsafe')},'isolated',{observationCeiling:2,knownSafeObservationError:()=>false}));assert.equal(calls,1);assert.equal(db.readTraversal().attempts[0].retryOrdinal,undefined);db.close();rmSync(dir,{recursive:true,force:true})});
test('fresh process consumes separately persisted authorization after crash before reservation exactly once',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-crash-'));const path=join(dir,'state.db');const ledger=join(dir,'sends.json');
 try {
  const crash=`import {DurableState} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from './dist/durable-discovery.js';const db=DurableState.open(${JSON.stringify(path)});let s=createTraversal(${JSON.stringify(geo)},{cells:1,submissions:3,activeTime:10});db.writeTraversal(s);let n=0;setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='retry-authorized')process.exit(0)});try{executeDurableDiscovery(db,()=>{if(++n===1)throw Object.assign(Error('safe'),{safe:true});return{id:'x'}},()=>({result:{status:'empty'},elapsed:1}),'isolated',{observationCeiling:0,submissionCeiling:1,knownSafeSubmissionError:e=>e.safe})}catch(e){console.error(e);process.exit(3)}`;
  const first=spawnSync(process.execPath,['--input-type=module','-e',crash],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  const resume=`import {DurableState} from './dist/durable-state.js';import {executeDurableDiscovery,resolveDurableRecoveryDebit} from './dist/durable-discovery.js';import {readFileSync,writeFileSync} from 'node:fs';const db=DurableState.open(${JSON.stringify(path)});resolveDurableRecoveryDebit(db,1,'synthetic bounded crash-to-restart interval');const f=${JSON.stringify(ledger)};let l=[];try{l=JSON.parse(readFileSync(f,'utf8'))}catch{};executeDurableDiscovery(db,()=>{l.push('send');writeFileSync(f,JSON.stringify(l));return{id:'x'}},()=>({result:{status:'empty'},elapsed:1}),'isolated',{observationCeiling:0,submissionCeiling:1,knownSafeSubmissionError:()=>false});db.close()`;
  const second=spawnSync(process.execPath,['--input-type=module','-e',resume],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(readFileSync(ledger,'utf8')),['send']);
  spawnSync(process.execPath,['--input-type=module','-e',resume],{encoding:'utf8'});assert.deepEqual(JSON.parse(readFileSync(ledger,'utf8')),['send']);
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('known-safe submission transient reserves a fresh durable slot and retries within ceiling',()=>{
 const dir=mkdtempSync(join(tmpdir(),'submission-retry-'));const db=DurableState.open(join(dir,'state.db'));let calls=0;
 try {db.writeTraversal(createTraversal(geo,{cells:1,submissions:2,activeTime:10}));
 executeDurableDiscovery(db,()=>{calls++;if(calls===1)throw Object.assign(Error('transient'),{safe:true});return{id:'synthetic'}},()=>({result:{status:'empty'},elapsed:1}),'isolated',{submissionCeiling:1,knownSafeSubmissionError:e=>e.safe});
 assert.equal(calls,2);assert.equal(db.readTraversal().submissions,2);assert.deepEqual(db.readTraversal().attempts.map(a=>a.submissionRetryOrdinal),[0,1]);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});
