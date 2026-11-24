import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { DurableState, setAfterOwnerReadForTest } from '../dist/durable-state.js';

const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'crawler-state-')); return { dir, path: join(dir, 'state.db') }; };
test('durable state persists atomic transitions and can be reopened', () => {
  const {dir,path}=temp();
  try { const state=DurableState.open(path); assert.deepEqual(state.read(), {version:1,work:[],observations:[],gaps:[]}); state.transition(s=>({...s,work:[{id:'work-1',status:'pending'}]})); state.close(); const reopened=DurableState.open(path); assert.equal(reopened.read().work[0].status,'pending'); reopened.close(); }
  finally { rmSync(dir,{recursive:true,force:true}); }
});
test('ownership remains exclusive when a contender opens after the owner read', () => {
  const {dir,path}=temp();
  try {
    let contenderError;
    setAfterOwnerReadForTest(() => {
      setAfterOwnerReadForTest(undefined);
      try { const contender=DurableState.open(path); contender.close(); }
      catch (error) { contenderError=error; }
    });
    const owner=DurableState.open(path);
    setAfterOwnerReadForTest(undefined);
    assert.match(String(contenderError),/locked|busy|owned/i);
    assert.throws(()=>DurableState.open(path),/owned/);
    owner.close();
  } finally { setAfterOwnerReadForTest(undefined); rmSync(dir,{recursive:true,force:true}); }
});
test('exclusive ownership rejects simultaneous contention and permits reacquisition after close', () => {
  const {dir,path}=temp();
  try { const owner=DurableState.open(path); assert.throws(()=>DurableState.open(path),/owned/); owner.close(); const reopened=DurableState.open(path); reopened.close(); }
  finally { rmSync(dir,{recursive:true,force:true}); }
});
test('simultaneous processes grant checkpoint ownership to at most one contender', async () => {
  const {dir,path}=temp();
  const release=join(dir,'release');
  const script=`import { existsSync, writeFileSync } from 'node:fs'; import { DurableState } from ${JSON.stringify(new URL('../dist/durable-state.js', import.meta.url).href)}; const [path,ready,release]=process.argv.slice(1); writeFileSync(ready, 'ready'); while (!existsSync(release)) await new Promise(r=>setTimeout(r,1)); try { const state=DurableState.open(path); console.log('owned'); await new Promise(r=>setTimeout(r,150)); state.close(); } catch (e) { if (/owned|busy|locked/i.test(e.message)) console.log('rejected'); else throw e; }`;
  const children=[0,1].map(index=>spawn(process.execPath,['--input-type=module','-e',script,path,join(dir,`ready-${index}`),release],{stdio:['ignore','pipe','pipe']}));
  try {
    const outcomesPromise=Promise.all(children.map(child=>new Promise((resolve,reject)=>{let out='',err=''; child.stdout.on('data',x=>out+=x); child.stderr.on('data',x=>err+=x); child.on('exit',code=>code===0?resolve(out.trim()):reject(new Error(err||`contender exited ${code}`)));})));
    while (!existsSync(join(dir,'ready-0')) || !existsSync(join(dir,'ready-1'))) await new Promise(r=>setTimeout(r,1));
    writeFileSync(release,'go');
    const outcomes=await outcomesPromise;
    assert.equal(outcomes.filter(x=>x==='owned').length,1,JSON.stringify(outcomes));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('rejects unsupported schema and corrupt persisted payload', () => {
  const {dir,path}=temp();
  try {
    let db=new DatabaseSync(path); db.exec("CREATE TABLE checkpoint(id INTEGER PRIMARY KEY, version INTEGER, payload TEXT); INSERT INTO checkpoint VALUES(1,2,'{}')"); db.close();
    assert.throws(()=>DurableState.open(path),/schema version/);
    db=new DatabaseSync(path); db.exec("UPDATE checkpoint SET version=1,payload='not-json'"); db.close();
    assert.throws(()=>DurableState.open(path));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('reacquires ownership after abrupt owner process death', () => {
  const {dir,path}=temp();
  try {
    const child=spawnSync(process.execPath,['--input-type=module','-e',`import {DurableState} from ${JSON.stringify(new URL('../dist/durable-state.js', import.meta.url).href)}; DurableState.open(${JSON.stringify(path)}); process.exit(0);`],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);
    const recovered=DurableState.open(path); recovered.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
