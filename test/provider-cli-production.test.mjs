import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
  assert.equal(pty.status,0,pty.stderr+pty.stdout); assert.ok(existsSync(checkpoint));
  const requests=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(requests.length,1); assert.match(requests[0].url,/dataset_id=gd_m8ebnr0q2qlklc02fz/);
  assert.equal(requests[0].body.input[0].zoom_level,invocation.zoom); assert.equal(requests[0].body.limit_per_input,invocation.limitPerInput);
  invocation.operation='resume'; invocation.limits.submissions=4;
  writeFileSync(evidence,JSON.stringify({evidence:{submission:technical('submission'),observation:technical('observation'),retrieval:technical('retrieval'),pricing:commercial(),rights:commercial()},estimate:{currency:'USD',amount:5,assumptions:'synthetic',uncertainty:'synthetic',pricingReference:'synthetic'}}));
  const resume=['dist/cli.js','resume','--provider','bright-data','--checkpoint',checkpoint,'--evidence',evidence,'--account','synthetic','--dataset',invocation.dataset,'--submissions','4'];
  const stale=spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py','stale-yes',process.execPath,...resume],{encoding:'utf8',timeout:15000,env:{...env,SYNTHETIC_CHECKPOINT:checkpoint}});
  assert.equal(stale.status,0,stale.stderr+stale.stdout); assert.match(stale.stdout,/Provider execution failed/);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,1);
  const resumed=spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py','yes-success',process.execPath,...resume],{encoding:'utf8',timeout:15000,env});
  assert.equal(resumed.status,0,resumed.stderr+resumed.stdout); assert.match(resumed.stdout,/"operation": "resume"/);
  assert.equal(readFileSync(calls,'utf8').trim().split('\n').length,1);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
