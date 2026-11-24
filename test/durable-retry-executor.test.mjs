import test from 'node:test'; import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, dispatchSubmission, markUncertain } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js'; import { executeDurableDiscovery } from '../dist/durable-discovery.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawnSync } from 'node:child_process';
const geo=validateGeometry({seed:{latitude:0,longitude:0},spacing:10,area:{type:'bbox',south:-1,north:1,west:-1,east:1}});
test('executor retries known ID safely with deterministic capped backoff',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-')); const path=join(dir,'state.db'); let sends=0, polls=0, waits=[];
 try { let db=DurableState.open(path); let s=createTraversal(geo,{cells:1,submissions:1,activeTime:10}); s=admitNextCell(s); s=reserveSubmission(s,'0,0'); s=dispatchSubmission(s,'0,0'); s=markUncertain(s,'0,0','isolated','id-1'); db.writeTraversal(s); db.close();
 db=DurableState.open(path); executeDurableDiscovery(db,()=>{sends++;return{id:'bad'}},()=>{polls++;if(polls===1)throw Error('known-safe');return{result:{status:'empty'},elapsed:1}},'isolated',{observationCeiling:1,knownSafeObservationError:e=>e.message==='known-safe',retryBaseDelayMs:25,retryMaxDelayMs:30,wait:ms=>waits.push(ms)});
 assert.equal(sends,0); assert.deepEqual(waits,[25]); assert.equal(db.readTraversal().submissions,1); assert.equal(db.readTraversal().attempts[0].retryOrdinal,1); db.close();
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('unsafe observation error is not retried',()=>{const dir=mkdtempSync(join(tmpdir(),'retry-'));const db=DurableState.open(join(dir,'state.db'));let s=createTraversal(geo,{cells:1,submissions:1,activeTime:10});s=admitNextCell(s);s=reserveSubmission(s,'0,0');s=dispatchSubmission(s,'0,0');s=markUncertain(s,'0,0','isolated','id');db.writeTraversal(s);let calls=0;assert.throws(()=>executeDurableDiscovery(db,()=>({id:'x'}),()=>{calls++;throw Error('unsafe')},'isolated',{observationCeiling:2,knownSafeObservationError:()=>false}));assert.equal(calls,1);assert.equal(db.readTraversal().attempts[0].retryOrdinal,undefined);db.close();rmSync(dir,{recursive:true,force:true})});
test('fresh process consumes separately persisted authorization after crash before reservation exactly once',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-crash-'));const path=join(dir,'state.db');const ledger=join(dir,'sends.json');
 try {
  const crash=`import {DurableState} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from './dist/durable-discovery.js';const db=DurableState.open(${JSON.stringify(path)});let s=createTraversal(${JSON.stringify(geo)},{cells:1,submissions:3,activeTime:10});db.writeTraversal(s);let n=0;setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='retry-authorized')process.exit(0)});try{executeDurableDiscovery(db,()=>{if(++n===1)throw Object.assign(Error('safe'),{safe:true});return{id:'x'}},()=>({result:{status:'empty'},elapsed:1}),'isolated',{observationCeiling:0,submissionCeiling:1,knownSafeSubmissionError:e=>e.safe})}catch(e){console.error(e);process.exit(3)}`;
  const first=spawnSync(process.execPath,['--input-type=module','-e',crash],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  {const db=DurableState.open(path);const state=db.readTraversal();assert.deepEqual(state.attempts,[{id:'work:0,0:attempt:1',workId:'work:0,0',cellKey:'0,0',status:'uncertain',submissionRetryOrdinal:0,safeRetryAuthorization:{ordinal:1,ceiling:1,delayMs:0}}]);assert.equal(state.submissions,1);db.close();}
  const resume=`import {DurableState} from './dist/durable-state.js';import {executeDurableDiscovery,resolveDurableRecoveryDebit} from './dist/durable-discovery.js';import {readFileSync,writeFileSync} from 'node:fs';const db=DurableState.open(${JSON.stringify(path)});resolveDurableRecoveryDebit(db,1,'synthetic bounded crash-to-restart interval');const f=${JSON.stringify(ledger)};let l=[];try{l=JSON.parse(readFileSync(f,'utf8'))}catch{};executeDurableDiscovery(db,()=>{l.push('send');writeFileSync(f,JSON.stringify(l));return{id:'x'}},()=>({result:{status:'empty'},elapsed:1}),'isolated',{observationCeiling:0,submissionCeiling:0,knownSafeSubmissionError:()=>false});db.close()`;
  const second=spawnSync(process.execPath,['--input-type=module','-e',resume],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);assert.deepEqual(JSON.parse(readFileSync(ledger,'utf8')),['send']);
  const third=spawnSync(process.execPath,['--input-type=module','-e',resume.replace("resolveDurableRecoveryDebit(db,1,'synthetic bounded crash-to-restart interval');",'')],{encoding:'utf8'});assert.notEqual(third.status,0);assert.match(third.stderr,/No recoverable discovery work/);assert.deepEqual(JSON.parse(readFileSync(ledger,'utf8')),['send']);
  const db=DurableState.open(path);const state=db.readTraversal();assert.deepEqual(state,{geometry:geo,limits:{cells:1,submissions:3,activeTime:10},queue:[],admitted:['0,0'],cells:{'0,0':{outcome:'empty'}},candidates:[],gaps:[{cellKey:'0,0',cause:'failed',scope:'isolated',status:'unresolved'}],paused:false,submissions:2,activeTime:2,blocked:[],attempts:[{id:'work:0,0:attempt:1',workId:'work:0,0',cellKey:'0,0',status:'uncertain',submissionRetryOrdinal:0,safeRetryAuthorization:{ordinal:1,ceiling:1,delayMs:0}},{id:'work:0,0:attempt:2',workId:'work:0,0',cellKey:'0,0',status:'observed',submissionRetryOrdinal:1,submissionRetryCeiling:1,knownId:'x'}],cancelled:false,recoveryPending:true,recoveryDebitEvidence:{elapsed:1,evidence:'synthetic bounded crash-to-restart interval'}});db.close();
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('known-safe submission transient reserves a fresh durable slot and retries within ceiling',()=>{
 const dir=mkdtempSync(join(tmpdir(),'submission-retry-'));const db=DurableState.open(join(dir,'state.db'));let calls=0;const waits=[];
 try {db.writeTraversal(createTraversal(geo,{cells:1,submissions:2,activeTime:10}));
 executeDurableDiscovery(db,()=>{calls++;if(calls===1)throw Object.assign(Error('transient'),{safe:true});return{id:'synthetic'}},()=>({result:{status:'empty'},elapsed:1}),'isolated',{submissionCeiling:1,knownSafeSubmissionError:e=>e.safe,retryBaseDelayMs:10,retryMaxDelayMs:15,wait:ms=>waits.push(ms)});
 assert.deepEqual(waits,[10]);assert.equal(calls,2);assert.equal(db.readTraversal().submissions,2);assert.deepEqual(db.readTraversal().attempts.map(a=>a.submissionRetryOrdinal),[0,1]);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('fresh restart never dispatches a persisted retry reservation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-reserved-')),path=join(dir,'state.db'),ledger=join(dir,'ledger');
 try{
 const crash=`import {DurableState,setAfterTraversalWriteForTest} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';import {executeDurableDiscovery} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});d.writeTraversal(createTraversal(${JSON.stringify(geo)},{cells:1,submissions:3,activeTime:10}));let authorized=false,writes=0;setAfterTraversalWriteForTest(()=>{});import {setDurableDiscoveryBoundaryHookForTest} from './dist/durable-discovery.js';setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='retry-authorized')authorized=true});executeDurableDiscovery(d,()=>{appendFileSync(${JSON.stringify(ledger)},'send\\n');throw Object.assign(Error('safe'),{safe:true})},()=>{throw Error('unexpected observation')},'isolated',{submissionCeiling:1,knownSafeSubmissionError:e=>e.safe});`;
 // Crash after the retry reservation has committed, before its dispatch.
 const script=crash.replace("setAfterTraversalWriteForTest(()=>{});", "setAfterTraversalWriteForTest(()=>{});").replace("if(x==='retry-authorized')authorized=true", "if(x==='retry-authorized')authorized=true");
 // The reservation transition has no public post-commit hook; crash at the next dispatch write, before commit.
 const injection=script.replace("setAfterTraversalWriteForTest(()=>{});", "setAfterTraversalWriteForTest(()=>{if(authorized&&++writes===3)process.exit(42)});");
 const child=spawnSync(process.execPath,['--input-type=module','-e',injection],{encoding:'utf8'});assert.equal(child.status,42,child.stderr);
 const before=DurableState.open(path);const s=before.readTraversal();assert.equal(s.submissions,2);assert.equal(s.attempts[1].status,'reserved');before.close();
 const recover=`import {DurableState} from './dist/durable-state.js';import {executeDurableDiscovery,resolveDurableRecoveryDebit} from './dist/durable-discovery.js';const d=DurableState.open(${JSON.stringify(path)});resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption');try{executeDurableDiscovery(d,()=>{throw Error('unexpected send')},()=>{throw Error('unexpected observation')},'isolated');throw Error('unexpected success')}catch(e){if(!/unknown outcome/.test(e.message))throw e}const s=d.readTraversal();if(s.submissions!==2||s.attempts[1].status!=='uncertain'||s.cells['0,0'].outcome!=='parked')throw Error(JSON.stringify(s));d.close()`;
 const resumed=spawnSync(process.execPath,['--input-type=module','-e',recover],{encoding:'utf8'});assert.equal(resumed.status,0,resumed.stderr);assert.equal(readFileSync(ledger,'utf8'),'send\n');
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('fresh process waits on persisted authorized submission retry before exactly one resend',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-wait-restart-')),path=join(dir,'state.db'),ledger=join(dir,'sends'),waitLog=join(dir,'waits');
 try {
  const crash=`import {DurableState} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});d.writeTraversal(createTraversal(${JSON.stringify(geo)},{cells:1,submissions:3,activeTime:10}));setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='retry-authorized')process.exit(42)});executeDurableDiscovery(d,()=>{appendFileSync(${JSON.stringify(ledger)},'send\\n');throw Object.assign(Error('safe'),{safe:true})},()=>{throw Error('unexpected')},'isolated',{submissionCeiling:1,knownSafeSubmissionError:e=>e.safe,retryBaseDelayMs:20,retryMaxDelayMs:50,wait:()=>{throw Error('first process should crash before wait')}})`;
  const first=spawnSync(process.execPath,['--input-type=module','-e',crash],{encoding:'utf8'});assert.equal(first.status,42,first.stderr);
  const prior=DurableState.open(path);const before=prior.readTraversal();assert.equal(before.attempts[0].safeRetryAuthorization.ordinal,1);assert.equal(before.submissions,1);prior.close();assert.equal(readFileSync(ledger,'utf8'),'send\n');
  const resume=`import {DurableState} from './dist/durable-state.js';import {executeDurableDiscovery,resolveDurableRecoveryDebit} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});resolveDurableRecoveryDebit(d,1,'synthetic interruption');executeDurableDiscovery(d,()=>{appendFileSync(${JSON.stringify(ledger)},'send\\n');return{id:'known'}},()=>({result:{status:'empty'},elapsed:2}),'isolated',{submissionCeiling:0,observationCeiling:0,knownSafeSubmissionError:()=>false,knownSafeObservationError:()=>false,retryBaseDelayMs:0,retryMaxDelayMs:0,wait:ms=>{const s=d.readTraversal();if(s.attempts[0].safeRetryAuthorization?.ordinal!==1||s.submissions!==1)throw Error('authorization not persisted before wait');appendFileSync(${JSON.stringify(waitLog)},String(ms))}});d.close()`;
  const second=spawnSync(process.execPath,['--input-type=module','-e',resume],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);assert.equal(readFileSync(waitLog,'utf8'),'20');assert.equal(readFileSync(ledger,'utf8'),'send\nsend\n');
  const finalDb=DurableState.open(path);const after=finalDb.readTraversal();assert.equal(after.submissions,2);assert.equal(after.activeTime,3);assert.equal(after.attempts.length,2);assert.equal(after.attempts[1].submissionRetryOrdinal,1);finalDb.close();
 } finally {rmSync(dir,{recursive:true,force:true})}
});

test('corrupt pending observation delay is rejected before callbacks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-corrupt-pending-'));const path=join(dir,'state.db');let sends=0,polls=0;
 try {const db=DurableState.open(path);let s=createTraversal(geo,{cells:1,submissions:1,activeTime:10});s=admitNextCell(s);s=reserveSubmission(s,'0,0');s=dispatchSubmission(s,'0,0');s=markUncertain(s,'0,0','isolated','known');s={...s,attempts:s.attempts.map(a=>({...a,status:'observing',retryOrdinal:1,observationRetryCeiling:1,observationRetryPendingDelayMs:-1}))};
  assert.throws(()=>db.writeTraversal(s),/Corrupt traversal checkpoint/);db.close();assert.equal(sends,0);assert.equal(polls,0);
 } finally {rmSync(dir,{recursive:true,force:true})}
});

test('persisted submission retry ceiling cannot be widened by a later caller policy',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-ceiling-'));const db=DurableState.open(join(dir,'state.db'));let calls=0;
 try {db.writeTraversal(createTraversal(geo,{cells:1,submissions:4,activeTime:10}));
 assert.throws(()=>executeDurableDiscovery(db,()=>{calls++;throw Object.assign(Error('safe'),{safe:true})},()=>{throw Error('unexpected')},'isolated',{submissionCeiling:1,knownSafeSubmissionError:e=>e.safe}));
 assert.throws(()=>executeDurableDiscovery(db,()=>{calls++;throw Object.assign(Error('safe'),{safe:true})},()=>{throw Error('unexpected')},'isolated',{submissionCeiling:3,knownSafeSubmissionError:e=>e.safe}),/No recoverable discovery work/);
 assert.equal(calls,2);assert.equal(db.readTraversal().attempts.filter(a=>a.submissionRetryOrdinal>0).length,1);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});
test('observation ceiling zero makes no retry call',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-zero-'));const db=DurableState.open(join(dir,'state.db'));let polls=0;
 try {db.writeTraversal(createTraversal(geo,{cells:1,submissions:1,activeTime:10}));
 assert.throws(()=>executeDurableDiscovery(db,()=>({id:'synthetic'}),()=>{polls++;throw Object.assign(Error('safe'),{safe:true})},'isolated',{observationCeiling:0,knownSafeObservationError:e=>e.safe}),/safe/);
 assert.equal(polls,1);assert.equal(db.readTraversal().attempts[0].retryOrdinal,undefined);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('legacy retryCeiling bounds submission ordinal and never authorizes observation retries',()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-retry-'));const db=DurableState.open(join(dir,'state.db'));let sends=0,polls=0;
 try {
  let s=createTraversal(geo,{cells:1,submissions:3,activeTime:10});s=admitNextCell(s);s=reserveSubmission(s,'0,0');s=dispatchSubmission(s,'0,0');
  s={...s,attempts:s.attempts.map(a=>({...a,status:'uncertain',retryCeiling:1,submissionRetryOrdinal:1}))};db.writeTraversal(s);
  assert.throws(()=>executeDurableDiscovery(db,()=>{sends++;throw Object.assign(Error('safe'),{safe:true})},()=>{polls++;throw Object.assign(Error('safe observation'),{safe:true})},'isolated',{submissionCeiling:5,observationCeiling:5,knownSafeSubmissionError:e=>e.safe,knownSafeObservationError:e=>e.safe}));
  assert.equal(sends,0);assert.equal(polls,0);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('caller ceiling widening during a send does not permit another submission retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-widen-'));const db=DurableState.open(join(dir,'state.db'));let sends=0,polls=0;const policy={submissionCeiling:1,observationCeiling:0,knownSafeSubmissionError:()=>true,knownSafeObservationError:()=>true};
 try {db.writeTraversal(createTraversal(geo,{cells:1,submissions:5,activeTime:10}));
  assert.throws(()=>executeDurableDiscovery(db,()=>{sends++;if(sends===2)policy.submissionCeiling=2;throw Error('synthetic send failure')},()=>{polls++;throw Error('synthetic observe failure')},'isolated',policy),/synthetic send failure/);
  assert.equal(sends,2);assert.equal(polls,0);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('successful submission retry is observed even when observation retry ceiling is zero',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-zero-observe-'));const db=DurableState.open(join(dir,'state.db'));let sends=0,polls=0;
 try {db.writeTraversal(createTraversal(geo,{cells:1,submissions:5,activeTime:10}));
  assert.throws(()=>executeDurableDiscovery(db,()=>{sends++;if(sends===2)return{id:'retry-id'};throw Object.assign(Error('synthetic send failure'),{safe:true})},()=>{polls++;throw Error('synthetic observe failure')},'isolated',{submissionCeiling:1,observationCeiling:0,knownSafeSubmissionError:e=>e.safe,knownSafeObservationError:()=>true}),/synthetic observe failure/);
  assert.equal(sends,2);assert.equal(polls,1);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('legacy known ID skips submission and performs one observation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-known-id-'));const db=DurableState.open(join(dir,'state.db'));let sends=0,polls=0;
 try {let s=createTraversal(geo,{cells:1,submissions:5,activeTime:10});s=admitNextCell(s);s=reserveSubmission(s,'0,0');s=dispatchSubmission(s,'0,0');s.attempts[0]={...s.attempts[0],submissionRetryOrdinal:1,retryCeiling:1,knownId:'legacy-id'};db.writeTraversal(s);
  assert.throws(()=>executeDurableDiscovery(db,()=>{sends++;throw Error('synthetic send failure')},()=>{polls++;throw Error('synthetic observe failure')},'isolated',{submissionCeiling:1,observationCeiling:5,knownSafeSubmissionError:()=>true,knownSafeObservationError:()=>true}),/synthetic observe failure/);
  assert.equal(sends,0);assert.equal(polls,1);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('legacy submission ordinal above ceiling is rejected before callbacks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-invalid-ordinal-'));const db=DurableState.open(join(dir,'state.db'));let sends=0,polls=0;
 try {let s=createTraversal(geo,{cells:1,submissions:5,activeTime:10});s=admitNextCell(s);s=reserveSubmission(s,'0,0');s=dispatchSubmission(s,'0,0');s.attempts[0]={...s.attempts[0],submissionRetryOrdinal:2,retryCeiling:1,knownId:'legacy-id'};
  assert.throws(()=>db.writeTraversal(s),/Corrupt traversal checkpoint/);
  assert.equal(sends,0);assert.equal(polls,0);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('legacy safe retry authorization permits exactly its authorized retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-safe-auth-'));const db=DurableState.open(join(dir,'state.db'));let sends=0,polls=0;const policy={submissionCeiling:1,observationCeiling:5,knownSafeSubmissionError:()=>true,knownSafeObservationError:()=>true};
 try {let s=createTraversal(geo,{cells:1,submissions:5,activeTime:10});s=admitNextCell(s);s=reserveSubmission(s,'0,0');s=dispatchSubmission(s,'0,0');s.attempts[0]={...s.attempts[0],status:'uncertain',submissionRetryOrdinal:0,retryCeiling:1,safeRetryAuthorization:{ordinal:1,ceiling:1}};db.writeTraversal(s);
  assert.throws(()=>executeDurableDiscovery(db,()=>{sends++;if(sends===1)policy.submissionCeiling=5;throw Error('synthetic send failure')},()=>{polls++;throw Error('synthetic observe failure')},'isolated',policy),/synthetic send failure/);
  assert.equal(sends,1);assert.equal(polls,0);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('legacy submission retry ceiling is used when a retry is authorized',()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-ceiling-'));const db=DurableState.open(join(dir,'state.db'));let sends=0;
 try {
  db.writeTraversal(createTraversal(geo,{cells:1,submissions:4,activeTime:10}));
  assert.throws(()=>executeDurableDiscovery(db,()=>{sends++;throw Object.assign(Error('safe'),{safe:true})},()=>{throw Error('unexpected')},'isolated',{submissionCeiling:1,knownSafeSubmissionError:e=>e.safe}));
  assert.equal(sends,2);
 } finally {db.close();rmSync(dir,{recursive:true,force:true})}
});

test('observation backoff persists across process death and changed delay policy',()=>{
 const dir=mkdtempSync(join(tmpdir(),'obs-wait-')),path=join(dir,'state.db'),ledger=join(dir,'ledger');
 try {
 const first=`import {DurableState} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';import {executeDurableDiscovery} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});d.writeTraversal(createTraversal(${JSON.stringify(geo)},{cells:1,submissions:1,activeTime:20}));executeDurableDiscovery(d,()=>{appendFileSync(${JSON.stringify(ledger)},'send\\n');return{id:'id'}},()=>{appendFileSync(${JSON.stringify(ledger)},'poll\\n');throw Error('safe')},'isolated',{observationCeiling:1,knownSafeObservationError:()=>true,retryBaseDelayMs:20,retryMaxDelayMs:20,wait:()=>process.exit(42)});`;
 const a=spawnSync(process.execPath,['--input-type=module','-e',first],{encoding:'utf8'});assert.equal(a.status,42,a.stderr);const d=DurableState.open(path);const before=d.readTraversal();assert.equal(before.recoveryPending,true);assert.equal(before.attempts[0].observationRetryPendingDelayMs,20);assert.equal(before.attempts[0].retryOrdinal,1);d.close();
 const second=`import {DurableState} from './dist/durable-state.js';import {executeDurableDiscovery,resolveDurableRecoveryDebit} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});resolveDurableRecoveryDebit(d,1,'bounded synthetic interruption');executeDurableDiscovery(d,()=>{throw Error('unexpected send')},()=>{appendFileSync(${JSON.stringify(ledger)},'poll\\n');return{result:{status:'empty'},elapsed:1}},'isolated',{observationCeiling:0,knownSafeObservationError:()=>true,retryBaseDelayMs:0,wait:ms=>appendFileSync(${JSON.stringify(ledger)},'wait '+ms+'\\n')});const s=d.readTraversal();if(s.submissions!==1||s.attempts[0].retryOrdinal!==1||s.attempts[0].observationRetryPendingDelayMs!==undefined)throw Error(JSON.stringify(s));d.close()`;
 const b=spawnSync(process.execPath,['--input-type=module','-e',second],{encoding:'utf8'});assert.equal(b.status,0,b.stderr);assert.deepEqual(readFileSync(ledger,'utf8').trim().split('\n'),['send','poll','wait 20','poll']);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('failed resumed observation exhausts allowance and pauses globally',()=>{
 const dir=mkdtempSync(join(tmpdir(),'obs-wait-')),path=join(dir,'state.db'),ledger=join(dir,'ledger');
 try {
 const first=`import {DurableState} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';import {executeDurableDiscovery} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});d.writeTraversal(createTraversal(${JSON.stringify(geo)},{cells:1,submissions:1,activeTime:20}));executeDurableDiscovery(d,()=>{appendFileSync(${JSON.stringify(ledger)},'send\\n');return{id:'id'}},()=>{appendFileSync(${JSON.stringify(ledger)},'poll\\n');throw Error('safe')},'global',{observationCeiling:1,knownSafeObservationError:()=>true,retryBaseDelayMs:20,retryMaxDelayMs:20,wait:()=>process.exit(42)});`;
 const a=spawnSync(process.execPath,['--input-type=module','-e',first],{encoding:'utf8'});assert.equal(a.status,42,a.stderr);const d=DurableState.open(path);const before=d.readTraversal();assert.equal(before.recoveryPending,true);assert.equal(before.attempts[0].observationRetryPendingDelayMs,20);assert.equal(before.attempts[0].retryOrdinal,1);d.close();
 const second=`import {DurableState} from './dist/durable-state.js';import {executeDurableDiscovery,resolveDurableRecoveryDebit} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});resolveDurableRecoveryDebit(d,1,'bounded synthetic interruption');try{executeDurableDiscovery(d,()=>{throw Error('unexpected send')},()=>{appendFileSync(${JSON.stringify(ledger)},'poll\\n');throw Error('safe')},'global',{observationCeiling:5,knownSafeObservationError:()=>true,retryBaseDelayMs:0,wait:ms=>appendFileSync(${JSON.stringify(ledger)},'wait '+ms+'\\n')});throw Error('unexpected success')}catch(e){if(e.message!=='safe')throw e}const s=d.readTraversal();if(s.submissions!==1||s.attempts[0].retryOrdinal!==1||s.attempts[0].status!=='uncertain'||!s.paused||!s.gaps.some(g=>g.scope==='global'))throw Error(JSON.stringify(s));d.close()`;
 const b=spawnSync(process.execPath,['--input-type=module','-e',second],{encoding:'utf8'});assert.equal(b.status,0,b.stderr);assert.deepEqual(readFileSync(ledger,'utf8').trim().split('\n'),['send','poll','wait 20','poll']);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('resumed observation exhausts remaining 1 of 2 retries and pauses globally',()=>{
 const dir=mkdtempSync(join(tmpdir(),'obs-wait-')),path=join(dir,'state.db'),ledger=join(dir,'ledger');
 try {
 const first=`import {DurableState} from './dist/durable-state.js';import {createTraversal} from './dist/traversal.js';import {executeDurableDiscovery} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});d.writeTraversal(createTraversal(${JSON.stringify(geo)},{cells:1,submissions:1,activeTime:20}));executeDurableDiscovery(d,()=>{appendFileSync(${JSON.stringify(ledger)},'send\\n');return{id:'id'}},()=>{appendFileSync(${JSON.stringify(ledger)},'poll\\n');throw Error('safe')},'global',{observationCeiling:2,knownSafeObservationError:()=>true,retryBaseDelayMs:20,retryMaxDelayMs:20,wait:()=>process.exit(42)});`;
 const a=spawnSync(process.execPath,['--input-type=module','-e',first],{encoding:'utf8'});assert.equal(a.status,42,a.stderr);const d=DurableState.open(path);const before=d.readTraversal();assert.equal(before.recoveryPending,true);assert.equal(before.attempts[0].observationRetryPendingDelayMs,20);assert.equal(before.attempts[0].retryOrdinal,1);d.close();
 const second=`import {DurableState} from './dist/durable-state.js';import {executeDurableDiscovery,resolveDurableRecoveryDebit} from './dist/durable-discovery.js';import {appendFileSync} from 'node:fs';const d=DurableState.open(${JSON.stringify(path)});resolveDurableRecoveryDebit(d,1,'bounded synthetic interruption');try{executeDurableDiscovery(d,()=>{throw Error('unexpected send')},()=>{appendFileSync(${JSON.stringify(ledger)},'poll\\n');throw Error('safe')},'global',{observationCeiling:5,knownSafeObservationError:()=>true,retryBaseDelayMs:0,wait:ms=>appendFileSync(${JSON.stringify(ledger)},'wait '+ms+'\\n')});throw Error('unexpected success')}catch(e){if(e.message!=='safe')throw e}const s=d.readTraversal();if(s.submissions!==1||s.attempts[0].retryOrdinal!==2||s.attempts[0].status!=='uncertain'||!s.paused||!s.gaps.some(g=>g.scope==='global'))throw Error(JSON.stringify(s));d.close()`;
 const b=spawnSync(process.execPath,['--input-type=module','-e',second],{encoding:'utf8'});assert.equal(b.status,0,b.stderr);assert.deepEqual(readFileSync(ledger,'utf8').trim().split('\n'),['send','poll','wait 20','poll','poll']);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('zero observation allowance survives reopen and cannot be widened',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zero-allowance-')),path=join(dir,'state.db');let sends=0,polls=0;
 try{let d=DurableState.open(path);d.writeTraversal(createTraversal(geo,{cells:1,submissions:1,activeTime:10}));const send=()=>{sends++;return{id:'known'}};const observe=()=>{polls++;throw Error('safe')};
 assert.throws(()=>executeDurableDiscovery(d,send,observe,'isolated',{observationCeiling:0,knownSafeObservationError:()=>true}),/safe/);assert.equal(d.readTraversal().attempts[0].observationRetryCeiling,0);d.close();
 d=DurableState.open(path);assert.throws(()=>executeDurableDiscovery(d,send,observe,'isolated',{observationCeiling:2,knownSafeObservationError:()=>true}),/safe/);assert.equal(sends,1);assert.equal(polls,2);assert.equal(d.readTraversal().submissions,1);d.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('legacy exhausted observation parks without changing its ceiling',()=>{
 const dir=mkdtempSync(join(tmpdir(),'legacy-observation-')),path=join(dir,'state.db');let polls=0,sends=0;
 try{let d=DurableState.open(path);let s=dispatchSubmission(reserveSubmission(admitNextCell(createTraversal(geo,{cells:1,submissions:1,activeTime:10})),'0,0'),'0,0');s.attempts[0]={...s.attempts[0],knownId:'id',retryOrdinal:1,retryCeiling:1};delete s.attempts[0].submissionRetryOrdinal;d.writeTraversal(s);d.close();
 for(let i=0;i<2;i++){d=DurableState.open(path);assert.throws(()=>executeDurableDiscovery(d,()=>{sends++;return{id:'bad'}},()=>{polls++;throw Error('safe')},'isolated',{observationCeiling:3,knownSafeObservationError:()=>true}),/safe/);const v=d.readTraversal();assert.equal(v.attempts[0].status,'uncertain');assert.equal(v.attempts[0].retryCeiling,1);assert.equal(v.submissions,1);d.close()};assert.equal(polls,2);assert.equal(sends,0);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('unambiguous legacy observation retains remaining allowance on reopen',()=>{const dir=mkdtempSync(join(tmpdir(),'legacy-remain-')),path=join(dir,'state.db');let polls=0;try{let d=DurableState.open(path);let s=dispatchSubmission(reserveSubmission(admitNextCell(createTraversal(geo,{cells:1,submissions:1,activeTime:10})),'0,0'),'0,0');s.attempts[0]={...s.attempts[0],knownId:'id',retryOrdinal:1,retryCeiling:2};delete s.attempts[0].submissionRetryOrdinal;d.writeTraversal(s);d.close();d=DurableState.open(path);assert.throws(()=>executeDurableDiscovery(d,()=>{throw Error('send')},()=>{polls++;throw Error('safe')},'isolated',{observationCeiling:9,knownSafeObservationError:()=>true}),/safe/);const v=d.readTraversal();assert.equal(polls,2);assert.equal(v.attempts[0].retryOrdinal,2);assert.equal(v.attempts[0].observationRetryCeiling,2);assert.equal(v.attempts[0].status,'uncertain');assert.equal(v.submissions,1);d.close()}finally{rmSync(dir,{recursive:true,force:true})}});

test('mixed legacy observation retains remaining allowance on reopen',()=>{const dir=mkdtempSync(join(tmpdir(),'legacy-remain-')),path=join(dir,'state.db');let polls=0;try{let d=DurableState.open(path);let s=dispatchSubmission(reserveSubmission(admitNextCell(createTraversal(geo,{cells:1,submissions:1,activeTime:10})),'0,0'),'0,0');s.attempts[0]={...s.attempts[0],knownId:'id',retryOrdinal:1,retryCeiling:2};s.attempts[0].submissionRetryOrdinal=0;s.attempts[0].submissionRetryCeiling=0;d.writeTraversal(s);d.close();d=DurableState.open(path);assert.throws(()=>executeDurableDiscovery(d,()=>{throw Error('send')},()=>{polls++;throw Error('safe')},'isolated',{observationCeiling:9,knownSafeObservationError:()=>true}),/safe/);const v=d.readTraversal();assert.equal(polls,2);assert.equal(v.attempts[0].retryOrdinal,2);assert.equal(v.attempts[0].observationRetryCeiling,2);assert.equal(v.attempts[0].status,'uncertain');assert.equal(v.submissions,1);d.close()}finally{rmSync(dir,{recursive:true,force:true})}});
