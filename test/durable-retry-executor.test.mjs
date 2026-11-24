import test from 'node:test'; import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, dispatchSubmission, markUncertain } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js'; import { executeDurableDiscovery } from '../dist/durable-discovery.js';
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const geo=validateGeometry({seed:{latitude:0,longitude:0},spacing:10,area:{type:'bbox',south:-1,north:1,west:-1,east:1}});
test('executor retries known ID safely and persists ordinal without spending a submission across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-')); const path=join(dir,'state.db'); let sends=0, polls=0;
 try { let db=DurableState.open(path); let s=createTraversal(geo,{cells:1,submissions:1,activeTime:10}); s=admitNextCell(s); s=reserveSubmission(s,'0,0'); s=dispatchSubmission(s,'0,0'); s=markUncertain(s,'0,0','isolated','id-1'); db.writeTraversal(s); db.close();
 db=DurableState.open(path); executeDurableDiscovery(db,()=>{sends++;return{id:'bad'}},()=>{polls++;if(polls===1)throw Error('known-safe');return{result:{status:'empty'},elapsed:1}},'isolated',{observationCeiling:1,knownSafeObservationError:e=>e.message==='known-safe'});
 assert.equal(sends,0); assert.equal(db.readTraversal().submissions,1); assert.equal(db.readTraversal().attempts[0].retryOrdinal,1); db.close();
 } finally {rmSync(dir,{recursive:true,force:true})}
});
test('unsafe observation error is not retried',()=>{const dir=mkdtempSync(join(tmpdir(),'retry-')); const db=DurableState.open(join(dir,'state.db'));let s=createTraversal(geo,{cells:1,submissions:1,activeTime:10});s=admitNextCell(s);s=reserveSubmission(s,'0,0');s=dispatchSubmission(s,'0,0');s=markUncertain(s,'0,0','isolated','id');db.writeTraversal(s);let calls=0;assert.throws(()=>executeDurableDiscovery(db,()=>({id:'x'}),()=>{calls++;throw Error('unsafe')},'isolated',{observationCeiling:2,knownSafeObservationError:()=>false}));assert.equal(calls,1);assert.equal(db.readTraversal().attempts[0].retryOrdinal,undefined);db.close();rmSync(dir,{recursive:true,force:true})});
