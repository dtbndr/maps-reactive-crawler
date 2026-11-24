import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { DurableState } from '../dist/durable-state.js';

const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'crawler-state-')); return { dir, path: join(dir, 'state.db') }; };
test('durable state persists atomic transitions and can be reopened', () => {
  const {dir,path}=temp();
  try { const state=DurableState.open(path); assert.deepEqual(state.read(), {version:1,work:[],observations:[],gaps:[]}); state.transition(s=>({...s,work:[{id:'work-1',status:'pending'}]})); state.close(); const reopened=DurableState.open(path); assert.equal(reopened.read().work[0].status,'pending'); reopened.close(); }
  finally { rmSync(dir,{recursive:true,force:true}); }
});
test('exclusive ownership rejects simultaneous contention and permits reacquisition after close', () => {
  const {dir,path}=temp();
  try { const owner=DurableState.open(path); assert.throws(()=>DurableState.open(path),/owned/); owner.close(); const reopened=DurableState.open(path); reopened.close(); }
  finally { rmSync(dir,{recursive:true,force:true}); }
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
