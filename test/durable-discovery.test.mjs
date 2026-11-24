import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, authorizeResend, markUncertain } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { executeDurableDiscovery } from '../dist/durable-discovery.js';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'durable-discovery-')); return { dir, path: join(dir, 'state.db') }; };

test('submission attempts have stable replay identities across uncertainty and resend', () => {
  let state = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
  const key = state.queue[0];
  state = admitNextCell(state);
  state = reserveSubmission(state, key);
  const first = state.attempts[0];
  assert.equal(typeof first.id, 'string');
  assert.equal(first.workId, `work:${key}`);
  state = { ...state, attempts: [{ ...first, status: 'dispatched' }] };
  state = markUncertain(state, key);
  state = authorizeResend(state, key);
  assert.equal(state.attempts[1].workId, first.workId);
  assert.notEqual(state.attempts[1].id, first.id);
});

test('failed durable traversal transition rolls back all state changes', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
    durable.writeTraversal(initial);
    assert.throws(() => durable.transitionTraversal(state => {
      const next = reserveSubmission(admitNextCell(state), '0,0');
      throw Object.assign(new Error('simulated partial application failure'), { next });
    }), /simulated partial application failure/);
    assert.deepEqual(durable.readTraversal(), initial);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid durable traversal transition rolls back and invalid ordinary writes are rejected', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
    durable.writeTraversal(initial);
    assert.throws(() => durable.transitionTraversal(state => ({ ...state, submissions: 1 })), /Corrupt traversal checkpoint/);
    assert.deepEqual(durable.readTraversal(), initial);
    assert.throws(() => durable.writeTraversal({ ...initial, submissions: 1 }), /Corrupt traversal checkpoint/);
    assert.deepEqual(durable.readTraversal(), initial);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed SQLite traversal payloads fail before execution and remain unchanged', () => {
  for (const mutate of [
    state => ({ ...state, cells: { ...state.cells, '0,0': { outcome: 'bogus' } } }),
    state => ({ ...state, admitted: [...state.admitted, '1,0'], cells: { ...state.cells, '1,0': { outcome: 'queued' } }, queue: [...state.queue, '1,0'] }),
    state => ({ ...state, attempts: [{ id: 'a', workId: 'work:0,0', cellKey: '0,0', status: 'dispatched', knownId: 42 }], submissions: 1 })
  ]) {
    const { dir, path } = temp();
    try {
      const d = DurableState.open(path);
      const initial = createTraversal(geometry, { cells: 1, submissions: 3, activeTime: 10 });
      d.writeTraversal(initial); d.close();
      const raw = new DatabaseSync(path);
      const payload = JSON.parse(raw.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
      raw.prepare('UPDATE traversal SET payload=? WHERE id=1').run(JSON.stringify(mutate(payload)));
      const malformed = raw.prepare('SELECT payload FROM traversal WHERE id=1').get().payload;
      raw.close();
      assert.throws(() => { const reopened = DurableState.open(path); try { reopened.readTraversal(); } finally { reopened.close(); } }, /Corrupt traversal checkpoint/);
      const verify = new DatabaseSync(path);
      assert.equal(verify.prepare('SELECT payload FROM traversal WHERE id=1').get().payload, malformed);
      verify.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('fresh process recovers traversal state after reservation before dispatch', () => {
  const { dir, path } = temp();
  try {
    const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
    const durableUrl = new URL('../dist/durable-state.js', import.meta.url).href;
    const script = `import {validateGeometry,createTraversal,admitNextCell,reserveSubmission} from ${JSON.stringify(moduleUrl)}; import {DurableState} from ${JSON.stringify(durableUrl)}; const g=validateGeometry({seed:{latitude:0,longitude:0},spacing:100,area:{type:'bbox',south:-1,north:1,west:-1,east:1}}); const d=DurableState.open(${JSON.stringify(path)}); d.writeTraversal(createTraversal(g,{cells:5,submissions:3,activeTime:10})); d.transitionTraversal(s=>reserveSubmission(admitNextCell(s),'0,0')); process.exit(0);`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const recovered = DurableState.open(path);
    const state = recovered.readTraversal();
    assert.equal(state.submissions, 1);
    assert.equal(state.attempts[0].status, 'reserved');
    assert.equal(state.attempts[0].id, 'work:0,0:attempt:1');
    recovered.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fresh-process crash matrix records independent sends and durable transition boundaries', () => {
  const durableUrl = new URL('../dist/durable-state.js', import.meta.url).href;
  const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
  for (const boundary of ['dequeued', 'reserved', 'dispatched', 'sent', 'id-persisted', 'observing', 'observed', 'committed']) {
    const { dir, path } = temp();
    try {
      const setup = DurableState.open(path);
      setup.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 }));
      setup.close();
      const ledgerPath = join(dir, 'independent-ledger.json');
      writeFileSync(ledgerPath, JSON.stringify({}));
      const script = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDiscoveryBoundaryHookForTest(x=>{if(x===${JSON.stringify(boundary)}) process.exit(41)}); executeDurableDiscovery(d,workId=>{const p=${JSON.stringify(ledgerPath)}; const l=JSON.parse(fs.readFileSync(p)); if(l[workId]) throw Error('duplicate send '+workId); l[workId]='process-job-id'; fs.writeFileSync(p,JSON.stringify(l)); return {id:'process-job-id'}},()=>({elapsed:2,result:{status:'success',candidates:[{id:'fixture-result',coordinate:null}]}}));`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
      assert.equal(child.status, 41, child.stderr);
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      const reopened = DurableState.open(path);
      const state = reopened.readTraversal();
      assert.deepEqual(Object.keys(ledger), ['sent', 'id-persisted', 'observing', 'observed', 'committed'].includes(boundary) ? ['work:0,0'] : [], boundary);
      assert.equal(state.submissions, ['reserved', 'dispatched', 'sent', 'id-persisted', 'observing', 'observed', 'committed'].includes(boundary) ? 1 : 0, boundary);
      if (boundary === 'committed') { assert.equal(state.cells['0,0'].outcome, 'nonempty'); assert.equal(state.activeTime, 2); }
      else assert.equal(state.cells['0,0'].outcome, ['dequeued', 'reserved', 'dispatched', 'sent', 'id-persisted', 'observing', 'observed'].includes(boundary) ? 'running' : 'queued');
      reopened.close();

      const resumed = DurableState.open(path);
      resumed.close();
      if (['dispatched', 'sent', 'reserved'].includes(boundary)) {
        const recoveryScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); const beforeTime=d.readTraversal().activeTime; resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().recoveryPending||d.readTraversal().activeTime!==beforeTime+1) throw Error('debit not persisted'); try { executeDurableDiscovery(d,()=>{throw Error('unexpected send')},()=>{throw Error('unexpected observation')}); process.exit(44); } catch(e) { if(!/unknown outcome/.test(e.message)) throw e; } const s=d.readTraversal(); if(s.attempts[0].workId!=='work:0,0'||s.attempts[0].status!=='uncertain'||s.cells['0,0'].outcome!=='parked'||s.gaps.length!==1||s.gaps[0].cellKey!=='0,0'||s.gaps[0].cause!=='uncertain'||!s.paused||s.queue.length) { console.error(JSON.stringify({attempt:s.attempts[0],cell:s.cells['0,0'],gaps:s.gaps,paused:s.paused,queue:s.queue})); process.exit(45); } d.close();`;
        const recoveredChild = spawnSync(process.execPath, ['--input-type=module', '-e', recoveryScript], { encoding: 'utf8' });
        assert.equal(recoveredChild.status, 0, recoveredChild.stderr);
        const parkedState = DurableState.open(path); const parked = parkedState.readTraversal(); parkedState.close();
        assert.equal(parked.attempts[0].workId, 'work:0,0');
        assert.equal(parked.attempts[0].status, 'uncertain');
        assert.equal(parked.cells['0,0'].outcome, 'parked');
        assert.deepEqual(parked.gaps, [{ cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' }]);
        assert.equal(parked.paused, true);
        assert.deepEqual(parked.queue, []);
      } else if (boundary !== 'committed') {
        const recoveryScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); const beforeTime=d.readTraversal().activeTime; resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().recoveryPending||d.readTraversal().activeTime!==beforeTime+1) throw Error('debit not persisted'); const p=${JSON.stringify(ledgerPath)}; executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(p)); if(l[w]) throw Error('duplicate send '+w); l[w]='process-job-id'; fs.writeFileSync(p,JSON.stringify(l)); return {id:'process-job-id'}},()=>({elapsed:2,result:{status:'success',candidates:[{id:'fixture-result',coordinate:null}]}})); d.close();`;
        const recoveredChild = spawnSync(process.execPath, ['--input-type=module', '-e', recoveryScript], { encoding: 'utf8' });
        assert.equal(recoveredChild.status, 0, recoveredChild.stderr);
        const verified = DurableState.open(path); const recovered = verified.readTraversal(); verified.close();
        assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledgerPath, 'utf8'))), ['work:0,0']);
        assert.equal(recovered.cells['0,0'].outcome, 'nonempty');
        assert.deepEqual(recovered.candidates.map(item => item.id), ['fixture-result']);
        assert.deepEqual(recovered.queue, ['0,1', '0,-1', '1,0', '-1,0']);
        assert.equal(recovered.submissions, 1);
        assert.equal(recovered.activeTime, 3);
        assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledgerPath, 'utf8'))), ['work:0,0']);
      } else {
        const recoveryScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); const beforeTime=d.readTraversal().activeTime; resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().recoveryPending||d.readTraversal().activeTime!==beforeTime+1) throw Error('debit not persisted'); const ledgerPath=${JSON.stringify(ledgerPath)}; const before=d.readTraversal(); executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(ledgerPath)); if(l[w]) throw new Error('duplicate work send'); l[w]=1; fs.writeFileSync(ledgerPath,JSON.stringify(l)); return {id:'id:'+w}},id=>({elapsed:1,result:{status:'empty'}})); const s=d.readTraversal(); if(s.cells['0,0'].outcome!=='nonempty'||s.candidates.length!==1||s.submissions!==2||s.activeTime!==4||s.cells['0,1'].outcome!=='empty'||s.attempts.length!==before.attempts.length+1) process.exit(43); d.close();`;
        const recoveredChild = spawnSync(process.execPath, ['--input-type=module', '-e', recoveryScript], { encoding: 'utf8' });
        assert.equal(recoveredChild.status, 0, recoveredChild.stderr);
        const afterChild = DurableState.open(path);
        const committed = afterChild.readTraversal();
        assert.equal(committed.cells['0,0'].outcome, 'nonempty');
        assert.deepEqual(committed.candidates.map(item => [item.id, item.sourceCell]), [['fixture-result', '0,0']]);
        assert.deepEqual(committed.gaps, []);
        assert.deepEqual(committed.queue, ['0,-1', '1,0', '-1,0']);
        assert.equal(committed.submissions, 2);
        assert.equal(committed.activeTime, 4);
        assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledgerPath, 'utf8'))), ['work:0,0', 'work:0,1']);
        afterChild.close();
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('fresh process death after application UPDATE but before COMMIT rolls back atomically', () => {
  const { dir, path } = temp();
  try {
    const setup = DurableState.open(path);
    setup.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 }));
    setup.close();
    const durableUrl = new URL('../dist/durable-state.js', import.meta.url).href;
    const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
    const ledgerPath = join(dir, 'precommit-ledger.json');
    writeFileSync(ledgerPath, JSON.stringify({}));
    const interruptionMarker = join(dir, 'termination-marker.json');
    const script = `import * as fs from 'node:fs'; import {DurableState,setAfterTraversalWriteForTest} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); let observed=false; setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='observed') observed=true}); setAfterTraversalWriteForTest(()=>{if(observed){fs.writeFileSync(${JSON.stringify(interruptionMarker)},JSON.stringify({termination:'abrupt',cleanPause:false})); process.exit(42)}}); executeDurableDiscovery(d,w=>{const p=${JSON.stringify(ledgerPath)}; const l=JSON.parse(fs.readFileSync(p)); if(l[w]) throw Error('duplicate send '+w); l[w]={id:'ledger-id',count:1}; fs.writeFileSync(p,JSON.stringify(l)); return {id:'ledger-id'}},()=>({elapsed:1,result:{status:'success',candidates:[{id:'raw',coordinate:null},{id:'raw',coordinate:null}]}}));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(child.status, 42, child.stderr);
    assert.deepEqual(JSON.parse(readFileSync(interruptionMarker, 'utf8')), { termination: 'abrupt', cleanPause: false });
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), { 'work:0,0': { id: 'ledger-id', count: 1 } });
    const reopened = DurableState.open(path);
    const state = reopened.readTraversal();
    assert.equal(state.submissions, 1);
    assert.equal(state.activeTime, 0);
    assert.equal(state.cells['0,0'].outcome, 'running');
    assert.equal(state.attempts[0].knownId, 'ledger-id');
    assert.equal(state.attempts[0].status, 'observing');
    assert.deepEqual(state.candidates, []);
    assert.deepEqual(state.gaps, []);
    assert.deepEqual(state.queue, []);
    reopened.close();
    const replayScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(new URL('../dist/durable-discovery.js', import.meta.url).href)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().activeTime!==1||d.readTraversal().recoveryPending) throw Error('debit not persisted'); const s=executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(${JSON.stringify(ledgerPath)})); if(l[w]) throw Error('duplicate resend'); throw Error('unexpected send')},id=>{if(id!=='ledger-id') throw new Error('wrong ID'); return {elapsed:1,result:{status:'success',candidates:[{id:'raw',coordinate:null},{id:'raw',coordinate:null}]}}}); if(JSON.stringify(s.candidates.map(x=>[x.id,x.sourceCell]))!==JSON.stringify([['raw','0,0'],['raw','0,0']])||s.gaps.length||JSON.stringify(s.queue)!==JSON.stringify(['0,1','0,-1','1,0','-1,0'])||s.activeTime!==2||s.submissions!==1) process.exit(45); d.close();`;
    const replayed = spawnSync(process.execPath, ['--input-type=module', '-e', replayScript], { encoding: 'utf8' });
    assert.equal(replayed.status, 0, replayed.stderr);
    const verified = DurableState.open(path);
    const recovered = verified.readTraversal();
    assert.deepEqual(recovered.candidates.map(item => [item.id, item.sourceCell]), [['raw', '0,0'], ['raw', '0,0']]);
    assert.deepEqual(recovered.gaps, []);
    assert.deepEqual(recovered.queue, ['0,1', '0,-1', '1,0', '-1,0']);
    assert.equal(recovered.activeTime, 2);
    assert.equal(recovered.submissions, 1);
    verified.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durable executor persists reservation before fixture send and applies response', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    durable.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 }));
    const ledgerPath = join(dir, 'send-ledger.json');
    let sends = 0;
    const result = executeDurableDiscovery(durable, workId => {
      const before = durable.readTraversal();
      assert.equal(before.attempts[0].status, 'dispatched');
      assert.equal(before.attempts[0].workId, workId);
      sends++;
      const ledger = { sends, workId, id: 'synthetic-id-1' };
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      return { id: ledger.id };
    }, id => { assert.equal(id, 'synthetic-id-1'); return { elapsed: 1, result: { status: 'success', candidates: [{ id: 'raw-id', coordinate: null }, { id: 'raw-id', coordinate: null }] } }; });
    assert.equal(sends, 1);
    assert.equal(JSON.parse(readFileSync(ledgerPath, 'utf8')).sends, 1);
    assert.equal(result.attempts[0].knownId, 'synthetic-id-1');
    assert.deepEqual(result.candidates.map(candidate => candidate.id), ['raw-id', 'raw-id']);
    assert.equal(result.cells['0,0'].outcome, 'nonempty');
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('send exception parks uncertain attempt and never automatically resends', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    durable.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 }));
    let sends = 0;
    assert.throws(() => executeDurableDiscovery(durable, () => { sends++; throw new Error('send boundary'); }, () => { throw new Error('must not observe'); }, 'isolated'), /send boundary/);
    assert.equal(sends, 1);
    assert.equal(durable.readTraversal().attempts[0].status, 'uncertain');
    assert.throws(() => executeDurableDiscovery(durable, () => { sends++; return { id: 'unexpected' }; }, () => ({ elapsed: 0, result: { status: 'empty' } }), 'isolated'), /No recoverable discovery work/);
    assert.equal(sends, 1);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('executor observation failure persists known ID; isolated resumes A after B while global blocks B', () => {
  for (const scope of ['isolated', 'global']) {
    const { dir, path } = temp();
    try {
      const durable = DurableState.open(path);
      let initial = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
      const key = initial.queue[0];
      initial = admitNextCell(initial);
      const nextKey = '1,0';
      initial = { ...initial, queue: [nextKey], admitted: [...initial.admitted, nextKey], cells: { ...initial.cells, [nextKey]: { outcome: 'queued' } } };
      durable.writeTraversal(initial);
      let sends = 0;
      assert.throws(() => executeDurableDiscovery(durable, () => { sends++; return { id: 'persisted-A-id' }; }, () => { throw new Error('observe boundary'); }, scope), /observe boundary/);
      assert.equal(durable.readTraversal().attempts[0].knownId, 'persisted-A-id');
      assert.equal(durable.readTraversal().cells[key].outcome, 'parked');
      if (scope === 'global') {
        assert.throws(() => executeDurableDiscovery(durable, () => { sends++; return { id: 'B-id' }; }, () => ({ elapsed: 0, result: { status: 'empty' } })), /Traversal is paused/);
        assert.equal(sends, 1);
      } else {
        executeDurableDiscovery(durable, () => { sends++; return { id: 'B-id' }; }, () => ({ elapsed: 0, result: { status: 'empty' } }), 'isolated');
        const result = executeDurableDiscovery(durable, () => { sends++; return { id: 'duplicate' }; }, id => {
          assert.equal(id, 'persisted-A-id');
          return { elapsed: 1, result: { status: 'empty' } };
        }, 'isolated');
        assert.equal(sends, 2);
        assert.equal(result.cells[key].outcome, 'empty');
        assert.equal(result.cells[nextKey].outcome, 'empty');
      }
      durable.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('fresh child crash while promoting parked A preserves running B and recovers A without resend', () => {
  const { dir, path } = temp();
  const durableUrl = new URL('../dist/durable-state.js', import.meta.url).href;
  const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
  try {
    const setup = DurableState.open(path);
    let state = createTraversal(geometry, { cells: 5, submissions: 2, activeTime: 10 });
    state = reserveSubmission(admitNextCell(state), '0,0');
    state = { ...state, attempts: state.attempts.map(a => ({ ...a, status: 'uncertain', knownId: 'A-id' })), cells: { ...state.cells, '0,0': { outcome: 'parked' } }, queue: ['1,0'], admitted: [...state.admitted, '1,0'], cells: { ...state.cells, '0,0': { outcome: 'parked' }, '1,0': { outcome: 'running' } }, submissions: 2 };
    state = { ...state, attempts: [...state.attempts, { ...state.attempts[0], id: 'work:1,0:attempt:1', workId: 'work:1,0', cellKey: '1,0', status: 'dispatched', knownId: 'B-id' }] };
    setup.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 2, activeTime: 10 }));
    const corruptDb = new DatabaseSync(path);
    corruptDb.prepare('UPDATE traversal SET payload=?').run(JSON.stringify(state));
    corruptDb.close();
    setup.close();
    const ledgerPath = join(dir, 'ledger.json');
    writeFileSync(ledgerPath, JSON.stringify({ 'work:0,0': 1, 'work:1,0': 1 }));
    const childScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='observing'){const s=d.readTraversal(); console.error(JSON.stringify({x,cells:s.cells,attempts:s.attempts})); process.exit(41)}}); executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(${JSON.stringify(ledgerPath)})); if(l[w]) throw Error('duplicate send '+w); l[w]=1; fs.writeFileSync(${JSON.stringify(ledgerPath)},JSON.stringify(l)); return {id:w==='work:0,0'?'A-id':'B-id'}},()=>({elapsed:1,result:{status:'empty'}}),'isolated');`;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], { encoding: 'utf8' });
    assert.equal(crashed.status, 41, crashed.stderr);
    const checkpoint = DurableState.open(path); const interrupted = checkpoint.readTraversal(); checkpoint.close();
    assert.equal(interrupted.cells['0,0'].outcome, 'running', crashed.stderr);
    assert.equal(interrupted.cells['1,0'].outcome, 'queued');
    assert.equal(Object.values(interrupted.cells).filter(c => c.outcome === 'running').length, 1);
    const resumeScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); const ledger=${JSON.stringify(ledgerPath)}; const send=w=>{const l=JSON.parse(fs.readFileSync(ledger)); if(l[w]) throw Error('duplicate send '+w); l[w]=1; fs.writeFileSync(ledger,JSON.stringify(l)); return {id:w==='work:0,0'?'A-id':'B-id'}}; executeDurableDiscovery(d,send,()=>({elapsed:1,result:{status:'empty'}}),'isolated'); executeDurableDiscovery(d,send,()=>({elapsed:1,result:{status:'empty'}}),'isolated'); d.close();`;
    const resumed = spawnSync(process.execPath, ['--input-type=module', '-e', resumeScript], { encoding: 'utf8' });
    assert.equal(resumed.status, 0, resumed.stderr);
    const final = DurableState.open(path); const result = final.readTraversal(); final.close();
    assert.equal(result.cells['0,0'].outcome, 'empty'); assert.equal(result.cells['1,0'].outcome, 'empty');
    assert.equal(result.submissions, 2); assert.equal(result.attempts.length, 2);
    assert.deepEqual(result.queue, []);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), { 'work:0,0': 1, 'work:1,0': 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('known-ID parked work is observed at submission cap ahead of queued work', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 1, activeTime: 10 });
    const key = initial.queue[0];
    let state = reserveSubmission(admitNextCell(initial), key);
    state = { ...state, attempts: state.attempts.map(attempt => ({ ...attempt, status: 'dispatched' })) };
    state = markUncertain(state, key, 'isolated', 'parked-id');
    const nextKey = '1,0';
    state = { ...state, queue: [nextKey], admitted: [...state.admitted, nextKey], cells: { ...state.cells, [nextKey]: { outcome: 'queued' } } };
    durable.writeTraversal(state);
    let sends = 0;
    const result = executeDurableDiscovery(durable, () => { sends++; throw new Error('must not send'); }, id => {
      assert.equal(id, 'parked-id');
      return { elapsed: 1, result: { status: 'empty' } };
    }, 'isolated');
    assert.equal(sends, 0);
    assert.equal(result.cells[key].outcome, 'empty');
    assert.equal(result.cells[nextKey].outcome, 'queued');
    assert.equal(result.submissions, 1);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('known-ID observation remains recoverable at active-time cap ahead of queued work', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 2, activeTime: 10 });
    const key = initial.queue[0];
    let state = reserveSubmission(admitNextCell(initial), key);
    state = { ...state, activeTime: state.limits.activeTime, attempts: state.attempts.map(a => ({ ...a, status: 'uncertain', knownId: 'time-cap-id' })), cells: { ...state.cells, [key]: { outcome: 'parked' } }, queue: ['1,0'], admitted: [...state.admitted, '1,0'], cells: { ...state.cells, [key]: { outcome: 'parked' }, '1,0': { outcome: 'queued' } } };
    durable.writeTraversal(state);
    const result = executeDurableDiscovery(durable, () => { throw new Error('must not send'); }, () => ({ elapsed: 1, result: { status: 'empty' } }), 'isolated');
    assert.equal(result.cells[key].outcome, 'empty');
    assert.equal(result.cells['1,0'].outcome, 'queued');
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('seed-expanded A and B survive process death at active-time cap and recover in a fresh process', () => {
  const { dir, path } = temp();
  try {
    const ledgerPath = join(dir, 'active-cap-ledger.json');
    writeFileSync(ledgerPath, JSON.stringify({}));
    let durable = DurableState.open(path);
    durable.writeTraversal(createTraversal(geometry, { cells: 12, submissions: 4, activeTime: 10 }));
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    const recordSend = id => workId => {
      assert.equal(ledger[workId], undefined);
      ledger[workId] = { id, count: 1 };
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      return { id };
    };
    executeDurableDiscovery(durable, recordSend('seed-id'), () => ({ elapsed: 0, result: { status: 'success', candidates: [{ id: 'seed-result', coordinate: null }] } }), 'isolated');
    let state = durable.readTraversal();
    const [keyA, keyB] = state.queue;
    assert.ok(keyA && keyB);
    durable.close();
    const durableUrl = new URL('../dist/durable-state.js', import.meta.url).href;
    const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
    const crashScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); const ledger=${JSON.stringify(ledgerPath)}; const ids=${JSON.stringify([[keyA,'A-id'],[keyB,'B-id']])}; for(const [key,id] of ids) { let failed=false; try { executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(ledger)); if(l[w]) throw Error('duplicate send'); l[w]={id,count:1}; fs.writeFileSync(ledger,JSON.stringify(l)); return {id}; },known=>{if(known!==id) throw Error('wrong ID '+known); throw Error('interrupt observation '+id);},'isolated'); } catch(e) { if(e.message!=='interrupt observation '+id) throw e; failed=true; } if(!failed) throw Error('observation did not interrupt '+id); } d.transitionTraversal(s=>({...s,activeTime:s.limits.activeTime})); if(d.readTraversal().activeTime!==d.readTraversal().limits.activeTime) throw Error('active-time cap not debited in child'); process.exit(42);`;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', crashScript], { encoding: 'utf8' });
    assert.equal(crashed.status, 42, crashed.stderr);
    const recovery = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); const before=d.readTraversal().activeTime; resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().recoveryPending||d.readTraversal().activeTime!==before+1) throw Error('debit not persisted'); const keys=${JSON.stringify([keyA,keyB])}; for(const [key,id] of [[keys[1],'B-id'],[keys[0],'A-id']]) { let observations=0; executeDurableDiscovery(d,()=>{throw Error('resent')},known=>{observations++; if(known!==id) throw Error('wrong ID '+known); return {elapsed:0,result:{status:'empty'}}},'isolated'); if(observations!==1) throw Error('observation count '+observations+' for '+id); if(d.readTraversal().cells[key].outcome!=='empty') throw Error('not applied '+key); } const l=JSON.parse(fs.readFileSync(${JSON.stringify(ledgerPath)})); if(Object.keys(l).length!==3 || Object.values(l).some(x=>x.count!==1)) throw Error('bad send ledger '+JSON.stringify(l)); if(d.readTraversal().submissions!==3) throw Error('submission cap exhausted/incorrect'); d.close();`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', recovery], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledgerPath, 'utf8'))).sort(), ['work:0,0', `work:${keyA}`, `work:${keyB}`].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('repeated known-ID observation failure reparks attempt without masking error', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 1, activeTime: 10 });
    let state = reserveSubmission(admitNextCell(initial), '0,0');
    state = { ...state, attempts: state.attempts.map(a => ({ ...a, status: 'uncertain', knownId: 'repeat-id' })), cells: { ...state.cells, '0,0': { outcome: 'parked' } } };
    durable.writeTraversal(state);
    assert.throws(() => executeDurableDiscovery(durable, () => assert.fail('no resend'), () => { throw new Error('observation unavailable'); }, 'global'), /observation unavailable/);
    const parked = durable.readTraversal();
    assert.equal(parked.attempts[0].status, 'uncertain');
    assert.equal(parked.cells['0,0'].outcome, 'parked');
    assert.equal(parked.paused, true);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durable executor commits dispatch, known ID and discovery application', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    let state = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
    durable.writeTraversal(state);
    durable.transitionTraversal(s => reserveSubmission(admitNextCell(s), '0,0'));
    durable.transitionTraversal(s => ({ ...s, attempts: s.attempts.map(a => ({ ...a, status: 'dispatched' })) }));
    durable.transitionTraversal(s => ({ ...s, attempts: s.attempts.map(a => ({ ...a, status: 'observed', knownId: 'synthetic-job-1' })) }));
    state = durable.readTraversal();
    assert.equal(state.attempts[0].knownId, 'synthetic-job-1');
    assert.equal(state.cells['0,0'].outcome, 'running');
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reopened database re-observes persisted known ID without resending or duplicating observations', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    durable.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 }));
    durable.transitionTraversal(s => reserveSubmission(admitNextCell(s), '0,0'));
    durable.transitionTraversal(s => ({ ...s, attempts: s.attempts.map(a => ({ ...a, status: 'dispatched' })) }));
    durable.transitionTraversal(s => ({ ...s, attempts: s.attempts.map(a => ({ ...a, knownId: 'ledger-id' })) }));
    durable.close();

    const ledgerPath = join(dir, 'send-ledger.json');
    writeFileSync(ledgerPath, JSON.stringify({ sends: 1, workId: 'work:0,0', id: 'ledger-id' }));
    const reopened = DurableState.open(path);
    let observeCount = 0;
    const result = executeDurableDiscovery(reopened, () => {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      ledger.sends++;
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      return { id: ledger.id };
    }, id => {
      observeCount++;
      assert.equal(id, 'ledger-id');
      return { elapsed: 2, result: { status: 'success', candidates: [{ id: 'same-raw-id', coordinate: null }, { id: 'same-raw-id', coordinate: null }] } };
    });
    assert.equal(JSON.parse(readFileSync(ledgerPath, 'utf8')).sends, 1);
    assert.equal(observeCount, 1);
    assert.equal(result.submissions, 1);
    assert.equal(result.activeTime, 2);
    assert.deepEqual(result.candidates.map(item => item.id), ['same-raw-id', 'same-raw-id']);
    assert.equal(result.cells['0,0'].outcome, 'nonempty');
    assert.deepEqual(result.queue, ['0,1', '0,-1', '1,0', '-1,0']);
    assert.deepEqual(result.gaps, []);
    assert.equal(result.attempts[0].knownId, 'ledger-id');
    assert.equal(result.attempts[0].status, 'observed');
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durable traversal transitions persist queue, observations, attempts and counters atomically', () => {
  const { dir, path } = temp();
  try {
    const state = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
    state.writeTraversal(initial);
    state.transitionTraversal(current => reserveSubmission(admitNextCell(current), '0,0'));
    assert.equal(state.readTraversal().submissions, 1);
    state.close();
    const reopened = DurableState.open(path);
    assert.deepEqual(reopened.readTraversal(), stateSnapshot(initial));
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
function stateSnapshot(initial) { return reserveSubmission(admitNextCell(initial), '0,0'); }

test('invalid persisted geometry and recovery marker fail before callbacks without changing payload', () => {
  for (const patch of [{ geometry: {} }, { recoveryPending: null }]) {
    const { dir, path } = temp();
    try {
      const durable = DurableState.open(path);
      const state = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
      durable.writeTraversal(state);
      const payload = JSON.stringify({ ...state, ...patch });
      const corruptDb = new DatabaseSync(path);
      corruptDb.prepare('UPDATE traversal SET payload=?').run(payload);
      corruptDb.close();
      durable.close();
      const reopened = DurableState.open(path);
      let sends = 0, observes = 0;
      assert.throws(() => executeDurableDiscovery(reopened, () => { sends++; return { id: 'bad' }; }, () => { observes++; return { elapsed: 0, result: { status: 'empty' } }; }), /Corrupt traversal checkpoint/, JSON.stringify(patch));
      assert.equal(sends, 0);
      assert.equal(observes, 0);
      assert.equal(new DatabaseSync(path).prepare('SELECT payload FROM traversal').get().payload, payload);
      reopened.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('corrupt queue referencing missing cell fails before send', () => {
  const { dir, path } = temp();
  try {
    const durable = DurableState.open(path);
    const state = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
    durable.writeTraversal(state);
    const corruptDb = new DatabaseSync(path);
    corruptDb.prepare('UPDATE traversal SET payload=?').run(JSON.stringify({ ...state, queue: ['missing'] }));
    corruptDb.close();
    let sends = 0;
    assert.throws(() => executeDurableDiscovery(durable, () => { sends++; return { id: 'bad' }; }, () => ({ elapsed: 0, result: { status: 'empty' } })), /Corrupt traversal checkpoint/);
    assert.equal(sends, 0);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
