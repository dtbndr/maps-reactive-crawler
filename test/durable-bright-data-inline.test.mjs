import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal } from '../dist/traversal.js';
import { runSyntheticBrightData } from '../dist/durable-bright-data-submission.js';

for (const [label, body, outcome] of [
 ['complete', [{name:'One', place_id:'p1', lat:51, lon:-1}], 'nonempty'],
 ['empty', [], 'empty'],
 ['capped', [{name:'One', place_id:'p1'}, {name:'Two', place_id:'p2'}], 'partial'],
 ['mixed', [{name:'One', place_id:'p1'}, {error:'synthetic'}], 'partial'],
 ['unknown', {unexpected:true}, 'parked'],
 ['malformed', [{error:'synthetic'}], 'parked'],
]) test(`inline ${label} is durable without snapshot operations`, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'inline-')); const path = join(dir, 'state.db');
 const binding = {version:2, mode:'bright-data', keyword:'pizza', country:'GB', zoom:14, limitPerInput: label === 'capped' ? 2 : 10};
 let state; let sends=0, observes=0, retrieves=0;
 try {
  DurableState.createBound(path, binding, createTraversal({seed:{latitude:51,longitude:-1},spacing:1000,area:{type:'radius',radius:2000}}, {cells:5,submissions:1,activeTime:10000}));
  state=DurableState.openBound(path,binding);
  const transport={submit:async()=>{sends++;return {status:200,body};},observe:async()=>{observes++;throw Error('unexpected');},retrieve:async()=>{retrieves++;throw Error('unexpected');}};
  const bounds=()=>({requestMilliseconds:1000,activeUntil:Date.now()+10000,maxObservations:1,observationDeadline:Date.now()+10000});
  await runSyntheticBrightData(state,transport,bounds()); state.close(); state=DurableState.openBound(path,binding);
  const s=state.readTraversal(); assert.equal(s.cells['0,0'].outcome,outcome); assert.equal(s.attempts[0].knownId,undefined);
  assert.equal(sends,1); assert.equal(observes,0); assert.equal(retrieves,0);
  if (outcome === 'nonempty') assert.ok(s.queue.length > 0);
  else { assert.deepEqual(s.queue,[]); if (outcome !== 'empty') assert.ok(s.gaps.some(g=>g.status==='unresolved')); }
  for (const c of s.candidates) { assert.equal(c.sourceCell,'0,0'); assert.equal(c.attemptId,s.attempts[0].id); assert.ok(s.detailWork.some(w=>w.observationIds.includes(c.observationId))); }
  if (outcome !== 'parked' && outcome !== 'empty') assert.ok(s.candidates.some(c=>c.id==='p1'));
  if (outcome === 'parked') { await runSyntheticBrightData(state,transport,bounds()); assert.equal(sends,1); }
 } finally { state?.close(); rmSync(dir,{recursive:true,force:true}); }
});
