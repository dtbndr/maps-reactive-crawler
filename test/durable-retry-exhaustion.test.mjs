import test from 'node:test'; import assert from 'node:assert/strict';
import {validateGeometry,createTraversal,reportTraversal} from '../dist/index.js'; import { DurableState } from '../dist/durable-state.js'; import { executeDurableDiscovery } from '../dist/durable-discovery.js';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
const geometry=validateGeometry({seed:{latitude:0,longitude:0},spacing:10,area:{type:'bbox',south:-1,north:1,west:-1,east:1}});
test('restart executes admitted B at S=4 after isolated A exhausts retries at 2/2 and reports partial_gaps',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retry-exhaust-')),dbPath=join(dir,'state.db'),ledger=join(dir,'ledger');
 try {writeFileSync(ledger,'0');let s=createTraversal(geometry,{cells:3,submissions:5,activeTime:100});s={...s,queue:['1,0'],admitted:['0,0','1,0'],cells:{'0,0':{outcome:'parked'},'1,0':{outcome:'queued'}},submissions:3,attempts:[0,1,2].map(n=>({id:`A${n}`,workId:'work:0,0',cellKey:'0,0',status:'uncertain',submissionRetryOrdinal:n,retryCeiling:2})),gaps:[{cellKey:'0,0',cause:'failed',scope:'isolated',status:'unresolved'}]};let db=DurableState.open(dbPath);db.writeTraversal(s);db.close();
 db=DurableState.open(dbPath);let calls=0;const result=executeDurableDiscovery(db,workId=>{calls++;writeFileSync(ledger,String(Number(readFileSync(ledger,'utf8')||'0')+1));assert.equal(workId,'work:1,0');return{id:'B-id'}},()=>({result:{status:'empty'},elapsed:1}),'isolated',{submissionCeiling:2,knownSafeSubmissionError:()=>true});
 assert.equal(calls,1);assert.equal(Number(readFileSync(ledger,'utf8')),1);assert.equal(result.submissions,4);assert.equal(result.attempts.filter(a=>a.cellKey==='0,0').at(-1).submissionRetryOrdinal,2);assert.equal(reportTraversal(result).outcome,'partial_gaps');db.close();
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
