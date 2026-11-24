import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const initialized=DurableState.open(path); initialized.close();
  const release=join(dir,'release');
  const script=`import { existsSync, writeFileSync } from 'node:fs'; import { DurableState } from ${JSON.stringify(new URL('../dist/durable-state.js', import.meta.url).href)}; const [path,result,release]=process.argv.slice(1); try { const state=DurableState.open(path); writeFileSync(result,'owned'); while (!existsSync(release)) await new Promise(r=>setTimeout(r,1)); state.close(); } catch (e) { if (/owned|busy|locked/i.test(e.message)) writeFileSync(result,'rejected'); else throw e; }`;
  const children=[0,1].map(index=>spawn(process.execPath,['--input-type=module','-e',script,path,join(dir,`result-${index}`),release],{stdio:['ignore','pipe','pipe']}));
  try {
    const outcomesPromise=Promise.all(children.map(child=>new Promise((resolve,reject)=>{let out='',err=''; child.stdout.on('data',x=>out+=x); child.stderr.on('data',x=>err+=x); child.on('exit',code=>code===0?resolve(out.trim()):reject(new Error(err||`contender exited ${code}`)));})));
    const deadline=Date.now()+5000;
    while ((!existsSync(join(dir,'result-0')) || !existsSync(join(dir,'result-1'))) && Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
    assert.ok(existsSync(join(dir,'result-0')) && existsSync(join(dir,'result-1')),'contenders did not report in time');
    writeFileSync(release,'go');
    await outcomesPromise;
    const outcomes=[0,1].map(index=>readFileSync(join(dir,`result-${index}`),'utf8'));
    assert.equal(outcomes.filter(x=>x==='owned').length,1,JSON.stringify(outcomes));
  } finally {
    for (const child of children) if (child.exitCode===null) child.kill('SIGKILL');
    await Promise.all(children.map(child=>child.exitCode!==null ? Promise.resolve() : new Promise(resolve=>{ const timer=setTimeout(resolve,2000); child.once('exit',()=>{clearTimeout(timer);resolve();}); })));
    rmSync(dir,{recursive:true,force:true});
  }
});
test('rejects structurally corrupt work and missing ownership metadata', () => {
  const {dir,path}=temp();
  try {
    let state=DurableState.open(path); state.close();
    let db=new DatabaseSync(path); db.prepare('UPDATE checkpoint SET payload=?').run(JSON.stringify({version:1,work:[null],observations:[],gaps:[]})); db.close();
    assert.throws(()=>DurableState.open(path),/corrupt/i);
    db=new DatabaseSync(path); db.exec('DROP TABLE owner'); db.close();
    assert.throws(()=>DurableState.open(path),/missing required table/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('fails closed for existing empty databases and malformed owner PIDs', () => {
  const {dir,path}=temp();
  try {
    writeFileSync(path, '');
    assert.throws(()=>DurableState.open(path),/corrupt|missing|required/i);
    const fresh=join(dir,'fresh.db'); const state=DurableState.open(fresh); state.close();
    const db=new DatabaseSync(fresh); db.prepare('INSERT INTO owner(id,pid) VALUES(1,?)').run(2147483648); db.close();
    assert.throws(()=>DurableState.open(fresh),/invalid owner PID/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('rejects unsupported schema and corrupt persisted payload', () => {
  const {dir,path}=temp();
  try {
    let db=new DatabaseSync(path); db.exec("CREATE TABLE checkpoint(id INTEGER PRIMARY KEY, version INTEGER, payload TEXT); CREATE TABLE owner(id INTEGER PRIMARY KEY, pid INTEGER); INSERT INTO checkpoint VALUES(1,2,'{}')"); db.close();
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
