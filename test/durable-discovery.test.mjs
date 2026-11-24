import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, authorizeResend, markUncertain } from '../dist/index.js';
import { DurableState } from '../dist/durable-state.js';
import { executeDurableDiscovery } from '../dist/durable-discovery.js';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
  for (const boundary of ['dequeued', 'reserved', 'dispatched', 'sent', 'id-persisted', 'committed']) {
    const { dir, path } = temp();
    try {
      const setup = DurableState.open(path);
      setup.writeTraversal(createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 }));
      setup.close();
      const ledgerPath = join(dir, 'independent-ledger.json');
      writeFileSync(ledgerPath, JSON.stringify({ sends: 0, id: 'process-job-id' }));
      const script = `import * as fs from 'node:fs'; import {DurableState} from ${JSON.stringify(durableUrl)}; import {executeDurableDiscovery,setDurableDiscoveryBoundaryHookForTest} from ${JSON.stringify(executorUrl)}; const d=DurableState.open(${JSON.stringify(path)}); setDurableDiscoveryBoundaryHookForTest(x=>{if(x===${JSON.stringify(boundary)}) process.exit(41)}); executeDurableDiscovery(d,()=>{const p=${JSON.stringify(ledgerPath)}; const l=JSON.parse(fs.readFileSync(p)); l.sends++; fs.writeFileSync(p,JSON.stringify(l)); return {id:l.id}},()=>({elapsed:1,result:{status:'empty'}}));`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
      assert.equal(child.status, 41, child.stderr);
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      const reopened = DurableState.open(path);
      const state = reopened.readTraversal();
      assert.equal(ledger.sends, ['sent', 'id-persisted', 'committed'].includes(boundary) ? 1 : 0, boundary);
      assert.equal(state.submissions, ['reserved', 'dispatched', 'sent', 'id-persisted', 'committed'].includes(boundary) ? 1 : 0, boundary);
      if (boundary === 'committed') { assert.equal(state.cells['0,0'].outcome, 'empty'); assert.equal(state.activeTime, 1); }
      else assert.equal(state.cells['0,0'].outcome, ['dequeued', 'reserved', 'dispatched', 'sent', 'id-persisted'].includes(boundary) ? 'running' : 'queued');
      reopened.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
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
    assert.throws(() => executeDurableDiscovery(durable, () => { sends++; throw new Error('send boundary'); }, () => { throw new Error('must not observe'); }), /send boundary/);
    assert.equal(sends, 1);
    assert.equal(durable.readTraversal().attempts[0].status, 'uncertain');
    assert.throws(() => executeDurableDiscovery(durable, () => { sends++; return { id: 'unexpected' }; }, () => ({ elapsed: 0, result: { status: 'empty' } })), /No queued cell to admit/);
    assert.equal(sends, 1);
    durable.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('isolated parked cell does not block the next queued cell, while global uncertainty blocks it', () => {
  for (const scope of ['isolated', 'global']) {
    const { dir, path } = temp();
    try {
      const durable = DurableState.open(path);
      const initial = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 10 });
      const key = initial.queue[0];
      let parked = reserveSubmission(admitNextCell(initial), key);
      parked = { ...parked, attempts: parked.attempts.map(attempt => ({ ...attempt, status: 'dispatched' })) };
      parked = markUncertain(parked, key, scope);
      const nextKey = '1,0';
      parked = { ...parked, queue: [nextKey], admitted: [...parked.admitted, nextKey], cells: { ...parked.cells, [nextKey]: { outcome: 'queued' } } };
      durable.writeTraversal(parked);
      if (scope === 'global') {
        assert.throws(() => executeDurableDiscovery(durable, () => ({ id: 'unused' }), () => ({ elapsed: 0, result: { status: 'empty' } })), /Traversal is paused/);
      } else {
        const result = executeDurableDiscovery(durable, () => ({ id: 'next-id' }), () => ({ elapsed: 0, result: { status: 'empty' } }));
        assert.equal(result.cells[key].outcome, 'parked');
        assert.equal(result.cells[nextKey].outcome, 'empty');
        assert.equal(result.attempts[0].status, 'uncertain');
      }
      durable.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
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

test('fresh process re-observes persisted known ID without resending or duplicating observations', () => {
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
