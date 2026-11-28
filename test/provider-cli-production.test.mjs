import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

function logicalState(path) {
 const db = new DatabaseSync(path, {readOnly:true});
 try {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name}) => [name, db.prepare(`SELECT * FROM "${name}"`).all().map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, key === 'payload' ? JSON.parse(value) : value])))]));
 } finally { db.close(); }
}

test('actual CLI affirmative start executes only downstream synthetic fetch', () => {
 const dir = mkdtempSync(join(tmpdir(), 'provider-cli-'));
 try {
  const checkpoint=join(dir,'checkpoint'), evidence=join(dir,'evidence'), calls=join(dir,'calls');
  const invocation={operation:'start',query:{keyword:'pizza',country:'GB'},geometry:{seed:{latitude:1,longitude:2},spacing:500,area:{type:'radius',radius:1000}},limits:{cells:4,submissions:3,activeTime:10000},account:'synthetic',dataset:'gd_m8ebnr0q2qlklc02fz',zoom:15,limitPerInput:20};
  const doc={reference:'synthetic',date:'2020-01-01',validThrough:'2099-01-01',scope:'synthetic'};
  const technical=method=>({...doc,attestation:{method,invocation}}), commercial=()=>({...doc,attestation:{invocation,collection:true,storage:true,export:true}});
  writeFileSync(evidence,JSON.stringify({evidence:{submission:technical('submission'),observation:technical('observation'),retrieval:technical('retrieval'),pricing:commercial(),rights:commercial()},estimate:{currency:'USD',amount:5,assumptions:'synthetic',uncertainty:'synthetic',pricingReference:'synthetic'}}));
  const args=['dist/cli.js','start','--provider','bright-data','--checkpoint',checkpoint,'--evidence',evidence,'--account','synthetic','--dataset',invocation.dataset,'--zoom','15','--limit-per-input','20','--keyword','pizza','--country','GB','--lat','1','--lon','2','--spacing-m','500','--radius-m','1000','--cells','4','--submissions','3','--active-ms','10000'];
  const env={...process.env,BRIGHT_DATA_API_KEY:'synthetic-key',SYNTHETIC_CALLS:calls,NODE_OPTIONS:'--import ./test/helpers/provider-fetch-preload.mjs'};
  const pty=spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py','yes-success',process.execPath,...args],{encoding:'utf8',timeout:15000,env});
  assert.equal(pty.status,0,pty.stderr+pty.stdout);
  assert.match(pty.stdout, /Confirm the displayed seed and provider action/);
  assert.ok(existsSync(checkpoint));
  const requests=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(requests.length,1); assert.match(requests[0].url,/dataset_id=gd_m8ebnr0q2qlklc02fz/);
  assert.equal(requests[0].body.input[0].zoom_level,invocation.zoom); assert.equal(requests[0].body.limit_per_input,invocation.limitPerInput);
  invocation.operation='resume'; invocation.limits.submissions=4;
  writeFileSync(evidence,JSON.stringify({evidence:{submission:technical('submission'),observation:technical('observation'),retrieval:technical('retrieval'),pricing:commercial(),rights:commercial()},estimate:{currency:'USD',amount:5,assumptions:'synthetic',uncertainty:'synthetic',pricingReference:'synthetic'}}));
  const resume=['dist/cli.js','resume','--provider','bright-data','--checkpoint',checkpoint,'--evidence',evidence,'--account','synthetic','--dataset',invocation.dataset,'--submissions','4'];
  const beforeStale=logicalState(checkpoint);
  const stale=spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py','stale-yes',process.execPath,...resume],{encoding:'utf8',timeout:15000,env:{...env,SYNTHETIC_CHECKPOINT:checkpoint}});
  assert.equal(stale.status,0,stale.stderr+stale.stdout); assert.match(stale.stdout,/Provider execution failed/);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,1);
  assert.deepEqual(logicalState(checkpoint),beforeStale);
  const resumed=spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py','yes-success',process.execPath,...resume],{encoding:'utf8',timeout:15000,env});
  assert.equal(resumed.status,0,resumed.stderr+resumed.stdout); assert.match(resumed.stdout,/"operation": "resume"/);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,1);
 } finally {rmSync(dir,{recursive:true,force:true});}
});


test('actual CLI resumes a bounded known-ID stop without resubmitting', () => {
 const dir=mkdtempSync(join(tmpdir(),'provider-cli-recovery-'));
 try {
  const checkpoint=join(dir,'checkpoint'), evidence=join(dir,'evidence'), calls=join(dir,'calls');
  const invocation={operation:'start',query:{keyword:'pizza',country:'GB'},geometry:{seed:{latitude:1,longitude:2},spacing:500,area:{type:'radius',radius:1000}},limits:{cells:1,submissions:1,activeTime:2000},account:'synthetic',dataset:'gd_m8ebnr0q2qlklc02fz',zoom:15,limitPerInput:20};
  const writeEvidence=()=>{ const doc={reference:'synthetic',date:'2020-01-01',validThrough:'2099-01-01',scope:'synthetic'}; const technical=method=>({...doc,attestation:{method,invocation}}), commercial=()=>({...doc,attestation:{invocation,collection:true,storage:true,export:true}}); writeFileSync(evidence,JSON.stringify({evidence:{submission:technical('submission'),observation:technical('observation'),retrieval:technical('retrieval'),pricing:commercial(),rights:commercial()},estimate:{currency:'USD',amount:5,assumptions:'synthetic',uncertainty:'synthetic',pricingReference:'synthetic'}})); };
  const env={...process.env,BRIGHT_DATA_API_KEY:'synthetic-key',SYNTHETIC_CALLS:calls,SYNTHETIC_SCENARIO:'known-id',NODE_OPTIONS:'--import ./test/helpers/provider-fetch-preload.mjs'};
  const run=(args,phase)=>spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py','yes-success',process.execPath,'dist/cli.js',...args],{encoding:'utf8',timeout:15000,env:{...env,SYNTHETIC_PHASE:phase}});
  const common=['--provider','bright-data','--checkpoint',checkpoint,'--evidence',evidence,'--account','synthetic','--dataset',invocation.dataset];
  writeEvidence();
  const started=run(['start',...common,'--zoom','15','--limit-per-input','20','--keyword','pizza','--country','GB','--lat','1','--lon','2','--spacing-m','500','--radius-m','1000','--cells','1','--submissions','1','--active-ms','2000'],'start');
  assert.equal(started.status,0,started.stderr+started.stdout);
  const stopped=logicalState(checkpoint).traversal[0].payload;
  assert.equal(stopped.attempts[0].knownId,'synthetic-id'); assert.equal(stopped.attempts[0].observationDisposition,'stopped');
  assert.ok(stopped.gaps.some(g=>g.status==='unresolved' && g.cause==='uncertain' && g.scope==='isolated'));
  invocation.operation='resume'; invocation.limits.activeTime=10000; writeEvidence();
  const resumed=run(['resume',...common,'--active-ms','10000'],'resume');
  assert.equal(resumed.status,0,resumed.stderr+resumed.stdout); assert.match(resumed.stdout,/synthetic-id/); assert.match(resumed.stdout,/"operation": "resume"/);
  const final=logicalState(checkpoint).traversal[0].payload;
  assert.equal(final.attempts.length,1); assert.equal(final.attempts[0].knownId,'synthetic-id'); assert.equal(final.attempts[0].status,'observed');
  assert.ok(final.candidates.some(c=>c.id==='synthetic-place' && c.sourceCell==='0,0' && c.attemptId===final.attempts[0].id));
  assert.ok(final.detailWork.some(w=>final.candidates.some(c=>w.observationIds.includes(c.observationId))));
  assert.ok(!final.gaps.some(g=>g.status==='unresolved'));
  const requests=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(requests.map(r=>[r.method,new URL(r.url).pathname]),[['POST','/datasets/v3/scrape'],['GET','/datasets/v3/progress/synthetic-id'],['GET','/datasets/v3/progress/synthetic-id'],['GET','/datasets/v3/snapshot/synthetic-id']]);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
