import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DurableState } from '../dist/durable-state.js';
import { createTraversal, admitNextCell, reserveSubmission, markUncertain } from '../dist/traversal.js';

test('valid provider evidence reaches fail-closed terminal confirmation without creating checkpoint', () => {
 const dir = mkdtempSync(join(tmpdir(), 'cli-preview-'));
 try {
  const checkpoint = join(dir, 'checkpoint'); const evidence = join(dir, 'evidence.json');
  const invocation = { operation:'start', query:{keyword:'pizza',country:'GB'}, geometry:{seed:{latitude:1,longitude:2},spacing:500,area:{type:'radius',radius:1000}}, limits:{cells:4,submissions:3,activeTime:1000}, account:'synthetic', dataset:'synthetic' };
  const doc = {reference:'synthetic',date:'2020-01-01',validThrough:'2099-01-01',scope:'synthetic'};
  const technical = method => ({...doc,attestation:{method,operation:'start',dataset:'synthetic'}});
  const commercial = () => ({...doc,attestation:{invocation,collection:true,storage:true,export:true}});
  writeFileSync(evidence, JSON.stringify({evidence:{submission:technical('submission'),observation:technical('observation'),retrieval:technical('retrieval'),pricing:commercial(),rights:commercial()},estimate:{currency:'USD',amount:5,assumptions:'three submissions',uncertainty:'may differ',pricingReference:'synthetic'}}));
  const args = ['dist/cli.js','start','--provider','bright-data','--checkpoint',checkpoint,'--evidence',evidence,'--account','synthetic','--dataset','synthetic','--keyword','pizza','--country','GB','--lat','1','--lon','2','--spacing-m','500','--radius-m','1000','--cells','4','--submissions','3','--active-ms','1000'];
  const result = spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(result.status,1); assert.match(result.stderr,/confirmation.*terminal/i); assert.equal(existsSync(checkpoint),false);
  for (const answer of ['yes', 'no']) {
   const pty = spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py',answer,process.execPath,...args],{encoding:'utf8',timeout:15000});
   assert.equal(pty.status,0,pty.stderr + pty.stdout);
   assert.ok(pty.stdout.indexOf('"uncertainty": "may differ"') < pty.stdout.indexOf('READY: Type yes'));
   assert.match(pty.stdout,/"submissions": 3/); assert.match(pty.stdout,/Direct API/);
   assert.match(pty.stdout,answer === 'yes' ? /not yet implemented/i : /declined or unavailable/i);
   assert.equal(existsSync(checkpoint),false);
  }
 } finally { rmSync(dir,{recursive:true,force:true}); }
});


test('child PTY resume previews effective checkpoint and never changes logical state or ownership', () => {
 const dir = mkdtempSync(join(tmpdir(), 'cli-resume-'));
 try {
  const checkpoint = join(dir, 'checkpoint.db'); const evidencePath = join(dir, 'evidence.json');
  const geometry = { seed:{latitude:51,longitude:-1}, spacing:1000, area:{type:'radius',radius:2000} };
  const limits = { cells:5, submissions:5, activeTime:10000 };
  const binding = {version:2,mode:'bright-data',keyword:'cafe',country:'GB',zoom:15,limitPerInput:20};
  let state = createTraversal(geometry, limits);
  state = reserveSubmission(admitNextCell(state), '0,0');
  state = {...state, attempts:state.attempts.map(a => ({...a,status:'dispatched'}))};
  state = markUncertain(state, '0,0', 'isolated', 'synthetic-job-id');
  DurableState.createBound(checkpoint, binding, state);
  const snapshot = () => { const db = new DatabaseSync(checkpoint, {readOnly:true}); try { return ['checkpoint','operator_binding','traversal','owner'].map(t => db.prepare(`SELECT * FROM ${t}`).all()); } finally { db.close(); } };
  const before = snapshot();
  const invocation = {operation:'resume',query:{keyword:'cafe',country:'GB'},geometry,limits:{...limits,submissions:9},account:'synthetic',dataset:'synthetic'};
  const doc = {reference:'synthetic',date:'2020-01-01',validThrough:'2099-01-01',scope:'synthetic'};
  const technical = method => ({...doc,attestation:{method,operation:'resume',dataset:'synthetic'}});
  const commercial = () => ({...doc,attestation:{invocation,collection:true,storage:true,export:true}});
  const record = {evidence:{submission:technical('submission'),observation:technical('observation'),retrieval:technical('retrieval'),pricing:commercial(),rights:commercial()},estimate:{currency:'USD',amount:5,assumptions:'synthetic',uncertainty:'synthetic',pricingReference:'synthetic'}};
  const args = ['dist/cli.js','resume','--provider','bright-data','--checkpoint',checkpoint,'--evidence',evidencePath,'--account','synthetic','--dataset','synthetic','--submissions','9'];
  writeFileSync(evidencePath, JSON.stringify(record));
  for (const answer of ['yes','no','buffered-yes-then-no']) {
   const pty = spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py',answer,process.execPath,...args],{encoding:'utf8',timeout:15000});
   assert.equal(pty.status,0,pty.stderr + pty.stdout);
   assert.match(pty.stdout, /"submissions": 9/); assert.match(pty.stdout, /"cells": 5/); assert.match(pty.stdout, /"activeTime": 10000/);
   assert.match(pty.stdout, /synthetic-job-id/);
   assert.ok(pty.stdout.indexOf('synthetic-job-id') < pty.stdout.indexOf('READY: Type yes'));
   assert.match(pty.stdout, answer === 'yes' ? /not yet implemented/i : /declined or unavailable/i);
   assert.deepEqual(snapshot(),before);
  }
  const nonTty = spawnSync(process.execPath,args,{encoding:'utf8',input:'yes\n'});
  assert.equal(nonTty.status,1); assert.match(nonTty.stderr,/confirmation.*terminal/i); assert.deepEqual(snapshot(),before);
  for (const invalid of [{...record,evidence:{}},{...record,estimate:undefined}]) {
   writeFileSync(evidencePath,JSON.stringify(invalid));
   const result = spawnSync('/usr/bin/python3',['test/helpers/provider-cli-pty.py','expect-blocked',process.execPath,...args],{encoding:'utf8',timeout:15000});
   assert.equal(result.status,0,result.stderr + result.stdout); assert.match(result.stdout,/missing or invalid/i); assert.doesNotMatch(result.stdout,/READY: Type yes/); assert.deepEqual(snapshot(),before);
  }
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
