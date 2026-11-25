import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTraversal,validateGeometry} from '../dist/index.js';
import {DurableState} from '../dist/durable-state.js';
import {executeDurableDiscovery,cancelDurableDiscovery} from '../dist/durable-discovery.js';
test('reentrant cancellation is rejected while execution is active',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cancel-active-')); const d=DurableState.open(join(dir,'state.db'));
 try {d.writeTraversal(createTraversal(validateGeometry({seed:{latitude:0,longitude:0},spacing:10,area:{type:'bbox',south:-1,north:1,west:-1,east:1}}),{cells:1,submissions:1,activeTime:100})); let attempted=false,sends=0;
 executeDurableDiscovery(d,()=>{sends++;return{id:'id'}},()=>({result:{status:'empty'},elapsed:0}),'global',undefined,{monotonicNow:()=>{if(!attempted&&d.readTraversal().attempts.at(-1)?.status==='dispatched'){attempted=true;assert.throws(()=>cancelDurableDiscovery(d),/active interval/);assert.equal(d.readTraversal().cancelled,false)}return 0}});
 assert.equal(attempted,true);assert.equal(sends,1);cancelDurableDiscovery(d);assert.equal(d.readTraversal().cancelled,true);
 } finally {d.close();rmSync(dir,{recursive:true,force:true})}
});
