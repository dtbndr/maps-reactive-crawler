import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, authorizeResend, markUncertain } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { executeDurableDiscovery, setDurableDiscoveryBoundaryHookForTest } from '../dist/durable-discovery.js';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'durable-discovery-')); return { dir, path: join(dir, 'state.db') }; };

test('global no-ID discovery uncertainty blocks second work after SQLite reopen and debit', () => {
  const { dir, path } = temp(); const ledger = join(dir, 'sends.txt');
  try {
    const state = DurableState.open(path); let initial = createTraversal(geometry, { cells: 5, submissions: 5, activeTime: 100 });
    const first = initial.queue[0]; initial = { ...initial, queue: [first, '1,0'], admitted: [first, '1,0'], cells: { ...initial.cells, '1,0': { outcome: 'queued' } } };
    state.writeTraversal(initial);
    assert.throws(() => executeDurableDiscovery(state, work => { writeFileSync(ledger, work); return {}; }, () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => 0 }));
    assert.equal(state.readTraversal().gaps.some(g => g.scope === 'global' && g.status === 'unresolved'), true);
    state.close();
    const reopened = DurableState.open(path);
    assert.throws(() => executeDurableDiscovery(reopened, work => { writeFileSync(ledger, work); return { id: 'B' }; }, () => ({ result: { status: 'empty' }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => 0 }), /paused|Global uncertainty/);
    assert.equal(readFileSync(ledger, 'utf8').length > 0, true);
    assert.equal(reopened.readTraversal().submissions, 1);
    reopened.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durable execution charges failed polls and retry waits using its monotonic clock', () => {
  const { dir, path } = temp();
  try {
    const state = DurableState.open(path);
    state.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 100 }));
    let now = 10;
    let polls = 0;
    const result = executeDurableDiscovery(state, () => ({ id: 'known' }), () => {
      now += 2;
      if (++polls === 1) throw new Error('temporary poll failure');
      return { result: { discovered: [] }, elapsed: 0 };
    }, 'global', { observationCeiling: 2, knownSafeObservationError: () => true, retryBaseDelayMs: 3, wait: ms => { now += ms; } }, { monotonicNow: () => now });
    assert.equal(result.activeTime, 7);
    assert.equal(result.submissions, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reported observation elapsed does not double count monotonic active time', () => {
  const { dir, path } = temp();
  try {
    const state = DurableState.open(path);
    state.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const result = executeDurableDiscovery(state, () => ({ id: 'known' }), () => ({ result: { status: 'empty' }, elapsed: 1 }), 'global', undefined, { monotonicNow: () => 0 });
    assert.equal(result.activeTime, 0);
    assert.equal(result.attempts.at(-1).knownId, 'known');
    state.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('durable result settlement applies elapsed time and discovery atomically', () => {
  const { dir, path } = temp();
  try {
    const state = DurableState.open(path);
    state.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    let now = 10;
    const transition = state.transitionTraversal.bind(state);
    let combined = false;
    state.transitionTraversal = change => transition(value => {
      const updated = change(value);
      if (updated.activeTime === 5 && updated.candidates?.some(item => item.id === 'candidate')) {
        combined = true;
        throw new Error('injected atomic settlement failure');
      }
      return updated;
    });
    assert.throws(() => executeDurableDiscovery(state, () => ({ id: 'known' }), () => {
      now = 15;
      return { result: { status: 'success', candidates: [{ id: 'candidate' }] }, elapsed: 0 };
    }, 'global', undefined, { monotonicNow: () => now }), /injected atomic settlement failure/);
    assert.equal(combined, true);
    const result = state.readTraversal();
    assert.equal(result.activeTime, 0);
    assert.equal(result.candidates?.some(item => item.id === 'candidate'), false);
    assert.equal(result.activeInterval, true);
    state.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed clock settlement preserves active interval without classifying a provider error', () => {
  const { dir, path } = temp();
  try {
    const state = DurableState.open(path);
    state.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 100 }));
    const samples = [10, 10, 10, 10, 10, 9, 11];
    let sends = 0;
    let observes = 0;
    assert.throws(() => executeDurableDiscovery(state, () => { sends++; return { id: 'known' }; }, () => { observes++; return { result: { discovered: [] }, elapsed: 0 }; }, 'global', undefined, { monotonicNow: () => samples.shift() }), /Invalid monotonic clock sample/);
    const result = state.readTraversal();
    assert.equal(sends, 0);
    assert.equal(observes, 0);
    assert.equal(result.activeInterval, true);
    assert.equal(result.activeTime, 0);
    assert.equal(result.attempts.at(-1).status, 'dispatched');
    assert.equal(samples.length, 1);
    assert.equal(samples[0], 11);
    state.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('settlement after dequeue at active-time cap does not reserve or send', () => {
  const { dir, path } = temp();
  try {
    const state = DurableState.open(path);
    state.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 5 }));
    let now = 0;
    let sends = 0;
    let observes = 0;
    setDurableDiscoveryBoundaryHookForTest(boundary => { if (boundary === 'dequeued') now = 5; });
    assert.throws(() => executeDurableDiscovery(state, () => { sends++; return { id: 'id' }; }, () => { observes++; return { result: { discovered: [] }, elapsed: 0 }; }, 'global', undefined, { monotonicNow: () => now }), /active-time limit/i);
    const result = state.readTraversal();
    assert.equal(sends, 0);
    assert.equal(observes, 0);
    assert.equal(result.activeTime, 5);
    assert.equal(result.submissions, 0);
    assert.equal(result.attempts.length, 0);
    assert.equal(result.cells['0,0'].outcome, 'running');
    state.close();
  } finally { setDurableDiscoveryBoundaryHookForTest(undefined); rmSync(dir, { recursive: true, force: true }); }
});

for (const stopBoundary of ['reserved', 'dispatched']) test(`confirmed no-send at ${stopBoundary} preserves debit and permits queued work`, () => {
  const { dir, path } = temp();
  try {
    let state = DurableState.open(path);
    const initial = createTraversal(geometry, { cells: 5, submissions: 2, activeTime: 5 });
    state.writeTraversal({ ...initial, queue: ['0,0', '1,0'], admitted: ['0,0', '1,0'], cells: { ...initial.cells, '1,0': { outcome: 'queued' } } });
    let now = 0;
    let aSends = 0;
    let bSends = 0;
    let observes = 0;
    setDurableDiscoveryBoundaryHookForTest(boundary => { if (boundary === stopBoundary) now = 5; });
    assert.throws(() => executeDurableDiscovery(state, () => { aSends++; return { id: 'A' }; }, () => { observes++; return { result: { discovered: [] }, elapsed: 0 }; }, 'global', undefined, { monotonicNow: () => now }), /active-time limit/i);
    let result = state.readTraversal();
    assert.equal(aSends, 0);
    assert.equal(observes, 0);
    assert.equal(result.attempts.at(-1).status, 'confirmed_no_send');
    assert.equal(result.submissions, 1);
    assert.equal(result.paused, false);
    assert.ok(result.gaps.some(gap => gap.cellKey === result.attempts.at(-1).cellKey && gap.cause === 'failed'));
    for (const patch of [{ retryOrdinal: 1, observationRetryCeiling: 1 }, { recoveryEvidence: { source: 'fixture', evidence: 'invalid', timestamp: '2026-01-01T00:00:00Z' } }, { observationRetryPendingDelayMs: 0 }]) {
      assert.throws(() => state.writeTraversal({ ...result, attempts: result.attempts.map(a => ({ ...a, ...patch })) }), /Corrupt traversal checkpoint/);
      assert.deepEqual(state.readTraversal(), result);
    }
    state.close();

    state = DurableState.open(path);
    state.transitionTraversal(current => ({ ...current, limits: { ...current.limits, activeTime: 10 } }));
    assert.equal(state.readTraversal().activeTime, 5);
    setDurableDiscoveryBoundaryHookForTest(undefined);
    const bKey = state.readTraversal().queue[0];
    executeDurableDiscovery(state, () => { bSends++; return { id: 'B' }; }, () => ({ result: { status: 'success', candidates: [] }, elapsed: 0 }), 'global', undefined, { monotonicNow: () => now });
    result = state.readTraversal();
    assert.equal(bSends, 1);
    assert.equal(aSends, 0);
    assert.equal(observes, 0);
    assert.equal(result.submissions, 2);
    assert.equal(result.cells[bKey].outcome, 'empty');
    assert.ok(result.gaps.some(gap => gap.cause === 'failed'));
    state.close();
  } finally { setDurableDiscoveryBoundaryHookForTest(undefined); rmSync(dir, { recursive: true, force: true }); }
});

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

test('SQLite traversal entries and fractional count limits are rejected without changing payload', () => {
  for (const mutate of [
    state => ({ ...state, candidates: [null] }),
    state => ({ ...state, gaps: [null] }),
    state => ({ ...state, blocked: ['999999,0'] }),
    state => ({ ...state, blocked: ['bogus'] })
  ]) {
    const { dir, path } = temp();
    try {
      const d = DurableState.open(path); d.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 3, activeTime: 10 })); d.close();
      const db = new DatabaseSync(path); const payload = JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
      const malformed = JSON.stringify(mutate(payload)); db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(malformed); db.close();
      let sends = 0;
      assert.throws(() => { const reopened = DurableState.open(path); try { executeDurableDiscovery(reopened, () => { sends++; return { status: 'empty' }; }); } finally { reopened.close(); } }, /Corrupt traversal checkpoint/);
      assert.equal(sends, 0);
      const check = new DatabaseSync(path); assert.equal(check.prepare('SELECT payload FROM traversal WHERE id=1').get().payload, malformed); check.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  assert.throws(() => createTraversal(geometry, { cells: 1, submissions: 0.5, activeTime: 10 }), /Invalid finite traversal limits/);
});

test('invalid canonical cell identities are rejected without changing their SQLite payload', () => {
  for (const key of ['bogus', '999999,0']) {
    const { dir, path } = temp();
    try {
      const durable = DurableState.open(path);
      durable.writeTraversal(createTraversal(geometry, { cells: 1, submissions: 3, activeTime: 10 }));
      durable.close();
      const db = new DatabaseSync(path);
      const payload = JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
      payload.queue = [key]; payload.admitted = [key]; payload.cells = { [key]: { outcome: 'queued' } };
      const malformed = JSON.stringify(payload);
      db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(malformed);
      db.close();
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
      const script = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDiscoveryBoundaryHookForTest(x=>{if(x===${JSON.stringify(boundary)}) process.exit(41)}); executeDurableDiscovery(d,workId=>{const p=${JSON.stringify(ledgerPath)}; const l=JSON.parse(fs.readFileSync(p)); if(l[workId]) throw Error('duplicate send '+workId); l[workId]='process-job-id'; fs.writeFileSync(p,JSON.stringify(l)); return {id:'process-job-id'}},()=>({elapsed:2,result:{status:'success',candidates:[{id:'fixture-result',coordinate:null,verifiedCanonicalKey:'fixture-place'},{id:'fixture-result',coordinate:null,verifiedCanonicalKey:'fixture-place'}]}}),'global',undefined,{monotonicNow:()=>0});`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
      assert.equal(child.status, 41, child.stderr);
      let committedPayload;
      if (boundary === 'committed') {
        const rawCommitted = new DatabaseSync(path, { readOnly: true });
        try { committedPayload = JSON.parse(rawCommitted.prepare('SELECT payload FROM traversal WHERE id=1').get().payload); }
        finally { rawCommitted.close(); }
      }
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      const reopened = DurableState.open(path);
      const state = reopened.readTraversal();
      assert.deepEqual(Object.keys(ledger), ['sent', 'id-persisted', 'observing', 'observed', 'committed'].includes(boundary) ? ['work:0,0'] : [], boundary);
      assert.equal(state.submissions, ['reserved', 'dispatched', 'sent', 'id-persisted', 'observing', 'observed', 'committed'].includes(boundary) ? 1 : 0, boundary);
      if (boundary === 'committed') { assert.equal(state.cells['0,0'].outcome, 'nonempty'); assert.equal(state.activeTime, 0); }
      else assert.equal(state.cells['0,0'].outcome, ['dequeued', 'reserved', 'dispatched', 'sent', 'id-persisted', 'observing', 'observed'].includes(boundary) ? 'running' : 'queued');
      reopened.close();

      const resumed = DurableState.open(path);
      resumed.close();
      if (['dispatched', 'sent', 'reserved'].includes(boundary)) {
        const recoveryScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); const beforeTime=d.readTraversal().activeTime; resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().recoveryPending||d.readTraversal().activeTime!==beforeTime+1) throw Error('debit not persisted'); try { executeDurableDiscovery(d,()=>{throw Error('unexpected send')},()=>{throw Error('unexpected observation')},'global',undefined,{monotonicNow:()=>0}); process.exit(44); } catch(e) { if(!/unknown outcome/.test(e.message)) throw e; } const s=d.readTraversal(); if(s.attempts[0].workId!=='work:0,0'||s.attempts[0].status!=='uncertain'||s.cells['0,0'].outcome!=='parked'||s.gaps.length!==1||s.gaps[0].cellKey!=='0,0'||s.gaps[0].cause!=='uncertain'||!s.paused||s.queue.length) { console.error(JSON.stringify({attempt:s.attempts[0],cell:s.cells['0,0'],gaps:s.gaps,paused:s.paused,queue:s.queue})); process.exit(45); } d.close();`;
        const recoveredChild = spawnSync(process.execPath, ['--input-type=module', '-e', recoveryScript], { encoding: 'utf8' });
        assert.equal(recoveredChild.status, 0, recoveredChild.stderr);
        const parkedState = DurableState.open(path); const parked = parkedState.readTraversal(); parkedState.close();
        assert.equal(parked.attempts[0].workId, 'work:0,0');
        assert.equal(parked.attempts[0].status, 'uncertain');
        assert.equal(parked.cells['0,0'].outcome, 'parked');
        assert.deepEqual(parked.gaps, [{ cellKey: '0,0', cause: 'uncertain', scope: 'global', status: 'unresolved' }]);
        assert.equal(parked.paused, true);
        assert.deepEqual(parked.queue, []);
        assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledgerPath, 'utf8'))), boundary === 'sent' ? ['work:0,0'] : []);
      } else if (boundary !== 'committed') {
        const recoveryScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); const beforeTime=d.readTraversal().activeTime; resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().recoveryPending||d.readTraversal().activeTime!==beforeTime+1) throw Error('debit not persisted'); const p=${JSON.stringify(ledgerPath)}; executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(p)); if(l[w]) throw Error('duplicate send '+w); l[w]='process-job-id'; fs.writeFileSync(p,JSON.stringify(l)); return {id:'process-job-id'}},()=>({elapsed:2,result:{status:'success',candidates:[{id:'fixture-result',coordinate:null,verifiedCanonicalKey:'fixture-place'},{id:'fixture-result',coordinate:null,verifiedCanonicalKey:'fixture-place'}]}}),'global',undefined,{monotonicNow:()=>0}); d.close();`;
        const recoveredChild = spawnSync(process.execPath, ['--input-type=module', '-e', recoveryScript], { encoding: 'utf8' });
        assert.equal(recoveredChild.status, 0, recoveredChild.stderr);
        const verified = DurableState.open(path); const recovered = verified.readTraversal(); verified.close();
        assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledgerPath, 'utf8'))), ['work:0,0']);
        assert.equal(recovered.cells['0,0'].outcome, 'nonempty');
        assert.deepEqual(recovered.candidates.map(item => item.id), ['fixture-result', 'fixture-result']);
        assert.deepEqual(recovered.queue, ['0,1', '0,-1', '1,0', '-1,0']);
        assert.equal(recovered.submissions, 1);
        assert.equal(recovered.activeTime, 1);
        assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledgerPath, 'utf8'))), ['work:0,0']);
      } else {
        const recoveryScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); const beforeTime=d.readTraversal().activeTime; resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().recoveryPending||d.readTraversal().activeTime!==beforeTime+1) throw Error('debit not persisted'); const ledgerPath=${JSON.stringify(ledgerPath)}; const before=d.readTraversal(); executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(ledgerPath)); if(l[w]) throw new Error('duplicate work send'); l[w]=1; fs.writeFileSync(ledgerPath,JSON.stringify(l)); return {id:'id:'+w}},id=>({elapsed:1,result:{status:'empty'}}),'global',undefined,{monotonicNow:()=>0}); const s=d.readTraversal(); const ids=[s.attempts[0].id+':observation:1',s.attempts[0].id+':observation:2']; if(s.cells['0,0'].outcome!=='nonempty'||JSON.stringify(s.candidates.map(x=>x.observationId))!==JSON.stringify(ids)||JSON.stringify(s.detailWork.map(x=>[x.id,x.observationIds]))!==JSON.stringify([['detail:verified:fixture-place',ids]])||s.submissions!==2||s.activeTime!==1||s.cells['0,1'].outcome!=='empty'||s.attempts.length!==before.attempts.length+1) process.exit(43); d.close();`;
        const recoveredChild = spawnSync(process.execPath, ['--input-type=module', '-e', recoveryScript], { encoding: 'utf8' });
        assert.equal(recoveredChild.status, 0, recoveredChild.stderr);
        const afterChild = DurableState.open(path);
        const committed = afterChild.readTraversal();
        assert.equal(committed.cells['0,0'].outcome, 'nonempty');
        const occurrenceIds = [`${committed.attempts[0].id}:observation:1`, `${committed.attempts[0].id}:observation:2`];
        for (const snapshot of [committedPayload, committed]) {
          assert.deepEqual(snapshot.candidates.map(item => item.observationId), occurrenceIds);
          assert.deepEqual(snapshot.detailWork.map(item => [item.id, item.observationIds]), [['detail:verified:fixture-place', occurrenceIds]]);
        }
        assert.deepEqual(committed.gaps, []);
        assert.deepEqual(committed.queue, ['0,-1', '1,0', '-1,0']);
        assert.equal(committed.submissions, 2);
        assert.equal(committed.activeTime, 1);
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
    const script = `import * as fs from 'node:fs'; import {DurableState,setAfterTraversalWriteForTest} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); let observed=false; setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='observed') observed=true}); setAfterTraversalWriteForTest(()=>{if(observed){fs.writeFileSync(${JSON.stringify(interruptionMarker)},JSON.stringify({termination:'abrupt',cleanPause:false})); process.exit(42)}}); executeDurableDiscovery(d,w=>{const p=${JSON.stringify(ledgerPath)}; const l=JSON.parse(fs.readFileSync(p)); if(l[w]) throw Error('duplicate send '+w); l[w]={id:'ledger-id',count:1}; fs.writeFileSync(p,JSON.stringify(l)); return {id:'ledger-id'}},()=>({elapsed:1,result:{status:'success',candidates:[{id:'raw',coordinate:null,verifiedCanonicalKey:'fixture-place'},{id:'raw',coordinate:null,verifiedCanonicalKey:'fixture-place'}]}}),'global',undefined,{monotonicNow:()=>0});`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(child.status, 42, child.stderr);
    assert.deepEqual(JSON.parse(readFileSync(interruptionMarker, 'utf8')), { termination: 'abrupt', cleanPause: false });
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), { 'work:0,0': { id: 'ledger-id', count: 1 } });
    const rawAfterCrash = new DatabaseSync(path);
    const payloadAfterCrash = JSON.parse(rawAfterCrash.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);
    rawAfterCrash.close();
    assert.equal(payloadAfterCrash.attempts[0].status, 'observing');
    assert.deepEqual(payloadAfterCrash.candidates, []);
    assert.ok(payloadAfterCrash.detailWork === undefined || payloadAfterCrash.detailWork.length === 0);
    const reopened = DurableState.open(path);
    const state = reopened.readTraversal();
    assert.equal(state.submissions, 1);
    assert.equal(state.activeTime, 0);
    assert.equal(state.cells['0,0'].outcome, 'running');
    assert.equal(state.attempts[0].knownId, 'ledger-id');
    assert.equal(state.attempts[0].status, 'observing');
    assert.deepEqual(state.candidates, []);
    assert.ok(state.detailWork === undefined || state.detailWork.length === 0);
    assert.deepEqual(state.gaps, []);
    assert.deepEqual(state.queue, []);
    reopened.close();
    const replayScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(new URL('../dist/durable-discovery.js', import.meta.url).href)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); if(d.readTraversal().activeTime!==1||d.readTraversal().recoveryPending) throw Error('debit not persisted'); const s=executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(${JSON.stringify(ledgerPath)})); if(l[w]) throw Error('duplicate resend'); throw Error('unexpected send')},id=>{if(id!=='ledger-id') throw new Error('wrong ID'); return {elapsed:1,result:{status:'success',candidates:[{id:'raw',coordinate:null,verifiedCanonicalKey:'fixture-place'},{id:'raw',coordinate:null,verifiedCanonicalKey:'fixture-place'}]}}},'global',undefined,{monotonicNow:()=>0}); if(JSON.stringify(s.candidates.map(x=>[x.id,x.sourceCell]))!==JSON.stringify([['raw','0,0'],['raw','0,0']])||s.gaps.length||JSON.stringify(s.queue)!==JSON.stringify(['0,1','0,-1','1,0','-1,0'])||s.activeTime!==1||s.submissions!==1) process.exit(45); d.close();`;
    const replayed = spawnSync(process.execPath, ['--input-type=module', '-e', replayScript], { encoding: 'utf8' });
    assert.equal(replayed.status, 0, replayed.stderr);
    const verified = DurableState.open(path);
    const recovered = verified.readTraversal();
    assert.deepEqual(recovered.candidates.map(item => [item.id, item.sourceCell, item.observationId, item.occurrence]), [['raw', '0,0', 'work:0,0:attempt:1:observation:1', 1], ['raw', '0,0', 'work:0,0:attempt:1:observation:2', 2]]);
    assert.deepEqual(recovered.detailWork.map(item => [item.id, item.observationIds]), [['detail:verified:fixture-place', ['work:0,0:attempt:1:observation:1', 'work:0,0:attempt:1:observation:2']]]);
    assert.deepEqual(recovered.gaps, []);
    assert.deepEqual(recovered.queue, ['0,1', '0,-1', '1,0', '-1,0']);
    assert.equal(recovered.activeTime, 1);
    assert.equal(recovered.submissions, 1);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), { 'work:0,0': { id: 'ledger-id', count: 1 } });
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
    }, id => { assert.equal(id, 'synthetic-id-1'); return { elapsed: 1, result: { status: 'success', candidates: [{ id: 'raw-id', coordinate: null }, { id: 'raw-id', coordinate: null }] } }; }, 'global', undefined, { monotonicNow: () => 0 });
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
    assert.throws(() => executeDurableDiscovery(durable, () => { sends++; throw new Error('send boundary'); }, () => { throw new Error('must not observe'); }, 'isolated', undefined, { monotonicNow: () => 0 }), /send boundary/);
    assert.equal(sends, 1);
    assert.equal(durable.readTraversal().attempts[0].status, 'uncertain');
    assert.throws(() => executeDurableDiscovery(durable, () => { sends++; return { id: 'unexpected' }; }, () => ({ elapsed: 0, result: { status: 'empty' } }), 'isolated', undefined, { monotonicNow: () => 0 }), /No recoverable discovery work/);
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
      assert.throws(() => executeDurableDiscovery(durable, () => { sends++; return { id: 'persisted-A-id' }; }, () => { throw new Error('observe boundary'); }, scope, undefined, { monotonicNow: () => 0 }), /observe boundary/);
      assert.equal(durable.readTraversal().attempts[0].knownId, 'persisted-A-id');
      assert.equal(durable.readTraversal().cells[key].outcome, 'parked');
      if (scope === 'global') {
        assert.throws(() => executeDurableDiscovery(durable, () => { sends++; return { id: 'B-id' }; }, () => ({ elapsed: 0, result: { status: 'empty' } }), 'global', undefined, { monotonicNow: () => 0 }), /Traversal is paused/);
        assert.equal(sends, 1);
      } else {
        executeDurableDiscovery(durable, () => { sends++; return { id: 'B-id' }; }, () => ({ elapsed: 0, result: { status: 'empty' } }), 'isolated', undefined, { monotonicNow: () => 0 });
        const result = executeDurableDiscovery(durable, () => { sends++; return { id: 'duplicate' }; }, id => {
          assert.equal(id, 'persisted-A-id');
          return { elapsed: 1, result: { status: 'empty' } };
        }, 'isolated', undefined, { monotonicNow: () => 0 });
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
    const ledgerPath = join(dir, 'ledger.json');
    writeFileSync(ledgerPath, '{}');
    let state = createTraversal(geometry, { cells: 5, submissions: 2, activeTime: 10 });
    state = { ...state, queue: ['0,0','1,0'], admitted: ['0,0','1,0'], cells: { '0,0': {outcome:'queued'}, '1,0': {outcome:'queued'} } };
    setup.writeTraversal(state);
    const send = w => { const ledger=JSON.parse(readFileSync(ledgerPath,'utf8')); ledger[w]=(ledger[w]??0)+1; writeFileSync(ledgerPath,JSON.stringify(ledger)); if(w==='work:0,0') throw Error('unknown acceptance'); return {id:'B-id'}; };
    assert.throws(() => executeDurableDiscovery(setup,send,()=>{throw Error('unexpected')},'isolated',undefined,{monotonicNow:()=>0}), /unknown acceptance/);
    setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='observing') throw Error('stop B before poll')});
    try { assert.throws(() => executeDurableDiscovery(setup,send,()=>{throw Error('unexpected')},'isolated',undefined,{monotonicNow:()=>0}), /stop B before poll/); } finally { setDurableDiscoveryBoundaryHookForTest(undefined); }
    state=setup.readTraversal();
    assert.equal(state.cells['0,0'].outcome,'parked'); assert.equal(state.cells['1,0'].outcome,'running');
    setup.close();
    const childScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {recoverDurableKnownId,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='observing'){const s=d.readTraversal(); console.error(JSON.stringify({x,cells:s.cells,attempts:s.attempts})); process.exit(41)}}); recoverDurableKnownId(d,'0,0','A-id',{source:'fixture',evidence:'synthetic lookup',timestamp:'2026-01-01T00:00:00Z'},()=>({elapsed:1,result:{status:'empty'}}),{monotonicNow:(()=>{let now=0; return ()=>{now+=3; return now;};})()});`;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], { encoding: 'utf8' });
    assert.equal(crashed.status, 41, crashed.stderr);
    const checkpoint = DurableState.open(path); const interrupted = checkpoint.readTraversal(); checkpoint.close();
    assert.equal(interrupted.cells['0,0'].outcome, 'running', crashed.stderr);
    assert.deepEqual(interrupted.attempts[0].recoveryEvidence,{source:'fixture',evidence:'synthetic lookup',timestamp:'2026-01-01T00:00:00Z'});
    assert.deepEqual(interrupted.cells['1,0'], state.cells['1,0']);
    assert.deepEqual(interrupted.attempts[1], state.attempts[1]);
    assert.equal(Object.values(interrupted.cells).filter(c => c.outcome === 'running').length, 2);
    const resumeScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing recovery accounting'); resolveDurableRecoveryDebit(d,1,'synthetic bounded interruption'); const debited=d.readTraversal(); if(debited.recoveryPending||debited.activeTime!==1||debited.recoveryDebitEvidence?.elapsed!==1||debited.recoveryDebitEvidence?.evidence!=='synthetic bounded interruption') throw Error('debit evidence not durably established before continuation '+JSON.stringify({activeTime:debited.activeTime,evidence:debited.recoveryDebitEvidence})); const ledger=${JSON.stringify(ledgerPath)}; const send=w=>{const l=JSON.parse(fs.readFileSync(ledger)); if(l[w]) throw Error('duplicate send '+w); l[w]=1; fs.writeFileSync(ledger,JSON.stringify(l)); return {id:w==='work:0,0'?'A-id':'B-id'}}; executeDurableDiscovery(d,send,()=>({elapsed:1,result:{status:'empty'}}),'isolated'); executeDurableDiscovery(d,send,()=>({elapsed:1,result:{status:'empty'}}),'isolated'); d.close();`;
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
    const crashScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); const ledger=${JSON.stringify(ledgerPath)}; const ids=${JSON.stringify([[keyA,'A-id'],[keyB,'B-id']])}; for(const [key,id] of ids) { let failed=false; try { executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(ledger)); if(l[w]) throw Error('duplicate send'); l[w]={id,count:1}; fs.writeFileSync(ledger,JSON.stringify(l)); return {id}; },known=>{if(known!==id) throw Error('wrong ID '+known); throw Error('interrupt observation '+id);},'isolated',undefined,{monotonicNow:()=>0}); } catch(e) { if(e.message!=='interrupt observation '+id) throw e; failed=true; } if(!failed) throw Error('observation did not interrupt '+id); } d.transitionTraversal(s=>({...s,activeTime:s.limits.activeTime})); if(d.readTraversal().activeTime!==d.readTraversal().limits.activeTime) throw Error('active-time cap not debited in child'); process.exit(42);`;
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

test('fresh-process known-ID recovery at exhausted active time commits detail fan-out and keeps neighbors blocked until cap increase', async () => {
  const { dir, path } = temp();
  try {
    const ledgerPath = join(dir, 'recovery-send-ledger.json');
    const tracePath = join(dir, 'shared-trace.json');
    writeFileSync(ledgerPath, JSON.stringify([]));
    writeFileSync(tracePath, JSON.stringify([]));
    let durable = DurableState.open(path);
    durable.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 5, activeTime: 5 }));
    durable.close();
    const durableUrl = new URL('../dist/durable-state.js', import.meta.url).href;
    const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
    const crash = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); const p=${JSON.stringify(ledgerPath)}; const t=${JSON.stringify(tracePath)}; const append=e=>{const l=JSON.parse(fs.readFileSync(p));l.push(e);fs.writeFileSync(p,JSON.stringify(l))}; setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='observing') process.exit(42)}); executeDurableDiscovery(d,w=>{append(['crash-submit',w]); return {id:'known-place'}},id=>{append(['crash-observe',id]);return {elapsed:0,result:{status:'success',candidates:[{id:'raw-place',verifiedCanonicalKey:'place:fixture',coordinate:{latitude:0,longitude:0}}]}}},'isolated',undefined,{monotonicNow:()=>0});`;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', crash], { encoding: 'utf8' });
    assert.equal(crashed.status, 42, crashed.stderr);
    durable = DurableState.open(path);
    assert.equal(durable.readTraversal().activeTime, 0);
    assert.equal(durable.readTraversal().recoveryPending, true);
    assert.deepEqual(durable.readTraversal().attempts.map(a => [a.id, a.knownId, a.status]), [['work:0,0:attempt:1', 'known-place', 'observing']]);
    durable.close();
    const recovery = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); const p=${JSON.stringify(ledgerPath)}; const append=e=>{const l=JSON.parse(fs.readFileSync(p));l.push(e);fs.writeFileSync(p,JSON.stringify(l))}; resolveDurableRecoveryDebit(d,5,'bounded child interruption'); const s=executeDurableDiscovery(d,w=>{append(['recovery-submit',w]);throw Error('resent')},id=>{append(['recovery-observe',id]);if(id!=='known-place') throw Error('wrong ID'); return {elapsed:0,result:{status:'success',candidates:[{id:'raw-place',verifiedCanonicalKey:'place:fixture',coordinate:{latitude:0,longitude:0}}]}}},'isolated',undefined,{monotonicNow:()=>0}); const x=d.readTraversal(); if(s.activeTime!==5||s.limits.activeTime!==5||s.cells['0,0'].outcome!=='nonempty'||JSON.stringify(s.candidates)!==JSON.stringify([{id:'raw-place',verifiedCanonicalKey:'place:fixture',coordinate:{latitude:0,longitude:0},classification:'inside',sourceCell:'0,0',observationId:'work:0,0:attempt:1:observation:1',attemptId:'work:0,0:attempt:1',occurrence:1}])||JSON.stringify(s.detailWork.map(w=>[w.id,w.observationIds,w.status]))!==JSON.stringify([['detail:verified:place:fixture',['work:0,0:attempt:1:observation:1'],'pending']])||JSON.stringify(s.queue)!=='[]'||JSON.stringify(s.blocked)!==JSON.stringify(['0,1','0,-1','1,0','-1,0'])||s.submissions!==1||s.attempts.length!==1||s.attempts[0].knownId!=='known-place'||s.attempts[0].status!=='observed'||x.recoveryPending) throw Error('incorrect recovered state '+JSON.stringify(s)); d.close();`;
    const recovered = spawnSync(process.execPath, ['--input-type=module', '-e', recovery], { encoding: 'utf8' });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), [['crash-submit', 'work:0,0'], ['recovery-observe', 'known-place']]);
    durable = DurableState.open(path);
    const pending = durable.readTraversal();
    assert.equal(pending.activeTime, pending.limits.activeTime);
    assert.deepEqual(pending.detailWork.map(w => [w.id, w.observationIds, w.status]), [['detail:verified:place:fixture', ['work:0,0:attempt:1:observation:1'], 'pending']]);
    assert.deepEqual(pending.blocked, ['0,1', '0,-1', '1,0', '-1,0']);
    const { executeDurableDetail } = await import('../dist/durable-discovery.js');
    const cappedBeforeDetail = durable.readTraversal();
    assert.throws(() => executeDurableDetail(durable, 'detail:verified:place:fixture', workId => {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); ledger.push(['detail-submit', workId]); writeFileSync(ledgerPath, JSON.stringify(ledger)); return { id: 'detail-job' };
    }, id => {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); ledger.push(['detail-observe', id]); writeFileSync(ledgerPath, JSON.stringify(ledger)); return { elapsed: 0 };
    }, { monotonicNow: () => 0 }), /Active-time limit reached before detail reservation/i);
    assert.equal(durable.readTraversal().submissions, cappedBeforeDetail.submissions);
    assert.equal(durable.readTraversal().attempts.length, cappedBeforeDetail.attempts.length);
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), [['crash-submit', 'work:0,0'], ['recovery-observe', 'known-place']]);
    durable.transitionTraversal(s => ({ ...s, limits: { ...s.limits, activeTime: 10 } }));
    durable.close();
    durable = DurableState.open(path);
    const later = durable.readTraversal();
    assert.equal(later.limits.activeTime, 10);
    assert.equal(later.activeTime, 5);
    assert.equal(later.detailWork[0].status, 'pending');
    assert.deepEqual(later.blocked, ['0,1', '0,-1', '1,0', '-1,0']);
    assert.deepEqual(later.queue, []);
    const beforeCandidates = structuredClone(later.candidates);
    const beforeAttempts = later.attempts.length;
    executeDurableDetail(durable, 'detail:verified:place:fixture', workId => {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); ledger.push(['detail-submit', workId]); writeFileSync(ledgerPath, JSON.stringify(ledger)); return { id: 'detail-job' };
    }, id => { const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); ledger.push(['detail-observe', id]); writeFileSync(ledgerPath, JSON.stringify(ledger)); assert.equal(id, 'detail-job'); return { elapsed: 0 }; }, { monotonicNow: () => 0 });
    const detailed = durable.readTraversal();
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), [['crash-submit', 'work:0,0'], ['recovery-observe', 'known-place'], ['detail-submit', 'detail:verified:place:fixture'], ['detail-observe', 'detail-job']]);
    assert.deepEqual(detailed.candidates, beforeCandidates);
    assert.equal(detailed.attempts.length, beforeAttempts);
    assert.equal(detailed.detailWork[0].status, 'completed');
    assert.deepEqual(detailed.blocked, ['0,1', '0,-1', '1,0', '-1,0']);
    assert.equal(detailed.submissions, 2);
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
    }, 'global', undefined, { monotonicNow: (() => { const samples = [0, 0, 2]; return () => samples.shift() ?? 2; })() });
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
      assert.throws(() => DurableState.open(path), /Corrupt traversal checkpoint/, JSON.stringify(patch));
      const verifyDb = new DatabaseSync(path);
      assert.equal(verifyDb.prepare('SELECT payload FROM traversal').get().payload, payload);
      verifyDb.close();
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

for (const [name, mutate] of [
 ['gap reference', s => ({...s,gaps:[{cellKey:'bogus',cause:'failed'}]})],
 ['candidate attempt reference', s => ({...s,candidates:[{id:'x',classification:'unverified',sourceCell:'0,0',observationId:'o',attemptId:'missing',occurrence:1}]})],
 ...['submissionRetryOrdinal','retryOrdinal','retryCeiling'].map(field => [field, s => ({...s,queue:[],cells:{'0,0':{outcome:'running'}},submissions:1,attempts:[{id:'work:0,0:attempt:1',workId:'work:0,0',cellKey:'0,0',status:'uncertain',[field]:-1}]})]),
 ['retry ordinal regression', s => ({...s,queue:[],cells:{'0,0':{outcome:'running'}},submissions:1,attempts:[{id:'work:0,0:attempt:1',workId:'work:0,0',cellKey:'0,0',status:'uncertain',submissionRetryOrdinal:2,safeRetryAuthorization:{ordinal:1,ceiling:3}}]})],
 ['retry authorization type', s => ({...s,queue:[],cells:{'0,0':{outcome:'running'}},submissions:1,attempts:[{id:'work:0,0:attempt:1',workId:'work:0,0',cellKey:'0,0',status:'uncertain',safeRetryAuthorization:{ordinal:1,ceiling:'2'}}]})]
]) test('reject invalid '+name+' before work',()=>{const {dir,path}=temp();try{const d=DurableState.open(path);d.writeTraversal(createTraversal(geometry,{cells:5,submissions:3,activeTime:10}));d.close();const db=new DatabaseSync(path);const initial=JSON.parse(db.prepare('SELECT payload FROM traversal WHERE id=1').get().payload);const bad=JSON.stringify(mutate(initial));db.prepare('UPDATE traversal SET payload=? WHERE id=1').run(bad);db.close();let calls=0;assert.throws(()=>{const x=DurableState.open(path);try{executeDurableDiscovery(x,()=>{calls++;return{id:'x'}},()=>{calls++;return{elapsed:0,result:{status:'empty'}}},'isolated',{submissionCeiling:2,isKnownSafeSubmissionError:()=>true})}finally{x.close()}},/Corrupt traversal checkpoint/);assert.equal(calls,0);const verify=new DatabaseSync(path);assert.equal(verify.prepare('SELECT payload FROM traversal WHERE id=1').get().payload,bad);verify.close()}finally{rmSync(dir,{recursive:true,force:true})}});

test('fresh-process recovery does not revive exhausted retry using a raised caller ceiling', () => {
  const { dir, path } = temp();
  try {
    const durableUrl = new URL('../dist/durable-state.js', import.meta.url).href;
    const executorUrl = new URL('../dist/durable-discovery.js', import.meta.url).href;
    const ledgerPath = join(dir, 'ceiling-ledger.json');
    writeFileSync(ledgerPath, JSON.stringify({}));
    const setupScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery} from ${JSON.stringify(executorUrl)}; import {validateGeometry,createTraversal} from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)}; const g=validateGeometry({seed:{latitude:0,longitude:0},spacing:100,area:{type:'bbox',south:-1,north:1,west:-1,east:1}}); const d=DurableState.open(${JSON.stringify(path)}); const initial=createTraversal(g,{cells:5,submissions:20,activeTime:20}); d.writeTraversal({...initial,queue:['0,0','1,0'],admitted:['0,0','1,0'],cells:{'0,0':{outcome:'queued'},'1,0':{outcome:'queued'}}}); let sends=0; try { executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(${JSON.stringify(ledgerPath)})); l[w]=(l[w]||0)+1; sends++; fs.writeFileSync(${JSON.stringify(ledgerPath)},JSON.stringify(l)); throw Error('safe failure')},()=>{throw Error('unexpected observe')},'isolated',{observationCeiling:0,submissionCeiling:2,knownSafeSubmissionError:()=>true},{monotonicNow:()=>0}); } catch(e) { if(e.message!=='safe failure') throw e; } if(sends!==3) throw Error('A did not send three times: '+sends); d.close();`;
    const setup = spawnSync(process.execPath, ['--input-type=module', '-e', setupScript], { encoding: 'utf8' });
    assert.equal(setup.status, 0, setup.stderr);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledgerPath, 'utf8'))), ['work:0,0']);
    const killScript = `import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDiscoveryBoundaryHookForTest(x=>{if(x==='dequeued') process.exit(42)}); executeDurableDiscovery(d,()=>({id:'unexpected'}),()=>({elapsed:1,result:{status:'empty'}}),'isolated',{observationCeiling:0,submissionCeiling:2,knownSafeSubmissionError:()=>true});`;
    const killed = spawnSync(process.execPath, ['--input-type=module', '-e', killScript], { encoding: 'utf8' });
    assert.equal(killed.status, 42, killed.stderr);
    const resumeScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,resolveDurableRecoveryDebit} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); if(!d.readTraversal().recoveryPending) throw Error('missing debit'); resolveDurableRecoveryDebit(d,1,'synthetic interruption'); executeDurableDiscovery(d,w=>{const l=JSON.parse(fs.readFileSync(${JSON.stringify(ledgerPath)})); if(l[w]) throw Error('duplicate '+w); l[w]=1; fs.writeFileSync(${JSON.stringify(ledgerPath)},JSON.stringify(l)); return {id:'B'}},()=>({elapsed:1,result:{status:'empty'}}),'isolated',{observationCeiling:0,submissionCeiling:9,knownSafeSubmissionError:()=>true},{monotonicNow:()=>0}); d.close();`;
    const resumed = spawnSync(process.execPath, ['--input-type=module', '-e', resumeScript], { encoding: 'utf8' });
    assert.equal(resumed.status, 0, resumed.stderr);
    const state = DurableState.open(path); const result = state.readTraversal(); state.close();
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, 'utf8')), {'work:0,0':3,'work:1,0':1});
    assert.equal(result.attempts.filter(a => a.cellKey === '0,0').length, 3);
    assert.equal(result.cells['0,0'].outcome, 'parked');
    assert.equal(result.cells['1,0'].outcome, 'empty');
    assert.deepEqual(result.gaps.map(g => [g.cellKey, g.cause]), [['0,0', 'failed'], ['0,0', 'failed'], ['0,0', 'uncertain']]);
    assert.equal(result.attempts.filter(a => a.cellKey === '0,0').at(-1).status, 'uncertain');
    assert.equal(result.limits.submissions, 20);
    const ledgerBeforeExhaustion = readFileSync(ledgerPath, 'utf8');
    const payloadBeforeExhaustion = JSON.stringify(result);
    for (const ceiling of [2, 9]) {
      const exhaustedScript = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); const before=JSON.stringify(d.readTraversal()); try { executeDurableDiscovery(d,w=>{fs.appendFileSync(${JSON.stringify(ledgerPath)},'unexpected'); return {id:'unexpected'}},()=>({elapsed:1,result:{status:'empty'}}),'isolated',{observationCeiling:0,submissionCeiling:${ceiling},knownSafeSubmissionError:()=>true},{monotonicNow:()=>0}); throw Error('expected exact retry exhaustion'); } catch(e) { if(e.message!=='No recoverable discovery work') throw e; } if(JSON.stringify(d.readTraversal())!==before) throw Error('durable payload changed'); d.close();`;
      const exhausted = spawnSync(process.execPath, ['--input-type=module', '-e', exhaustedScript], { encoding: 'utf8' });
      assert.equal(exhausted.status, 0, exhausted.stderr);
      assert.equal(readFileSync(ledgerPath, 'utf8'), ledgerBeforeExhaustion);
      const verify = DurableState.open(path); assert.equal(JSON.stringify(verify.readTraversal()), payloadBeforeExhaustion); verify.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
