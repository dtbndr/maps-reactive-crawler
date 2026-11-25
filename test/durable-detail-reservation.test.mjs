import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, observeKnownId, applyDiscoveryResult } from '../dist/index.js';
import { reserveDetailSubmission, dispatchDetailSubmission, recordDetailId, completeDetailWork } from '../dist/traversal.js';
import { executeDurableDetail, executeDurableDiscovery, cancelDurableDiscovery, resolveDurableRecoveryDebit } from '../dist/durable-discovery.js';
import { DurableState } from '../dist/durable-state.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 100, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
function discovered() {
  let state = createTraversal(geometry, { cells: 5, submissions: 3, activeTime: 100 });
  const key = state.queue[0]; state = reserveSubmission(admitNextCell(state), key);
  state = { ...state, attempts: state.attempts.map(a => ({ ...a, status: 'dispatched', knownId: 'raw' })) };
  state = observeKnownId(state, key, 'raw', 0);
  return applyDiscoveryResult(state, key, { status: 'success', candidates: [{ id: 'one', verifiedCanonicalKey: 'fixture-place' }, { id: 'two', verifiedCanonicalKey: 'fixture-place-two' }] });
}
function temp() { const dir = mkdtempSync(join(tmpdir(), 'detail-reservation-')); return { dir, path: join(dir, 'state.db') }; }

test('verified detail completion resolves only matching unresolved detail gaps', () => {
  const base = discovered();
  const work = base.detailWork[0];
  let state = { ...base, detailGaps: [
    { workId: work.id, identity: work.identity, observationIds: [...work.observationIds], status: 'unresolved' },
    { workId: work.id, identity: work.identity, observationIds: [...work.observationIds], status: 'skipped' },
    { workId: 'other', identity: 'verified:other', observationIds: [], status: 'unresolved' }
  ] };
  state = reserveDetailSubmission(state, work.id);
  state = dispatchDetailSubmission(state, work.id);
  state = recordDetailId(state, work.id, 'detail-id');
  state = completeDetailWork(state, work.id, 'detail-id');
  assert.deepEqual(state.detailGaps.map(gap => gap.status), ['resolved', 'skipped', 'unresolved']);
  assert.deepEqual(state.gaps, base.gaps);
});

test('detail execution persists the known ID before observation and consumes shared submission accounting', () => {
  const { dir, path } = temp(); const d = DurableState.open(path); let sends = 0; let observedId;
  try {
    const base = discovered(); d.writeTraversal(base);
    let now = 0;
    const result = executeDurableDetail(d, base.detailWork[0].id, () => { sends++; now += 4; return { id: 'detail-id' }; }, id => { observedId = id; now += 3; return { elapsed: 3 }; }, { monotonicNow: () => now });
    assert.equal(sends, 1); assert.equal(observedId, 'detail-id');
    assert.equal(result.submissions, 2); assert.equal(result.activeTime, 7);
    assert.equal(result.detailWork[0].status, 'completed');
    assert.equal(result.detailWork[0].attempts[0].knownId, 'detail-id');
    assert.deepEqual(d.readTraversal(), result);
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('detail executor enforces active-time cap before reserving and accounts callback time through shared clock', () => {
  const { dir, path } = temp(); const d = DurableState.open(path); let sends = 0; let now = 10;
  try {
    const base = { ...discovered(), limits: { ...discovered().limits, activeTime: 0 } }; d.writeTraversal(base);
    const workId = base.detailWork[0].id;
    assert.throws(() => executeDurableDetail(d, workId, () => { sends++; return { id: 'x' }; }, () => ({ elapsed: 0 }), { monotonicNow: () => 0 }), /limit/i);
    assert.equal(sends, 0); assert.equal(d.readTraversal().submissions, 1);
    d.transitionTraversal(value => ({ ...value, activeTime: 0, limits: { ...value.limits, activeTime: 100 } })); now = 0;
    const result = executeDurableDetail(d, workId, () => { sends++; now += 4; return { id: 'x' }; }, () => { now += 3; return { elapsed: 3 }; }, { monotonicNow: () => now });
    assert.equal(sends, 1); assert.equal(result.activeTime, 7);
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('detail callbacks reject nested execution and cancellation without extra sends, preserving time and final state', () => {
  const { dir, path } = temp(); const d = DurableState.open(path); let clock = 0; let sends = 0; let nestedRejected = false; let cancelRejected = false;
  try {
    const base = discovered(); d.writeTraversal(base); const workId = base.detailWork[0].id;
    const result = executeDurableDetail(d, workId, () => {
      sends++; clock += 2;
      assert.throws(() => executeDurableDetail(d, workId, () => { sends++; return { id: 'nested' }; }, () => ({ elapsed: 0 }), { monotonicNow: () => clock }), /active interval/i); nestedRejected = true;
      assert.throws(() => cancelDurableDiscovery(d), /active interval/i); cancelRejected = true;
      return { id: 'detail-id' };
    }, id => { assert.equal(id, 'detail-id'); clock += 3; return { elapsed: 3 }; }, { monotonicNow: () => clock });
    assert.equal(nestedRejected, true); assert.equal(cancelRejected, true); assert.equal(sends, 1);
    assert.equal(result.activeTime, 5); assert.equal(result.activeInterval, false); assert.equal(result.cancelled, false);
    assert.equal(result.detailWork[0].status, 'completed'); assert.deepEqual(d.readTraversal(), result);
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('known detail ID recovers by observation only at active-time cap and over it, including after reopen', () => {
  const { dir, path } = temp(); const d = DurableState.open(path); let sends = 0; let observations = 0;
  try {
    let state = discovered(); const id = state.detailWork[0].id;
    state = reserveDetailSubmission(state, id); state = dispatchDetailSubmission(state, id);
    state = recordDetailId(state, id, 'known');
    state = { ...state, activeTime: 100 }; d.writeTraversal(state); d.close();
    const reopened = DurableState.open(path);
    let tick = 7;
    const result = executeDurableDetail(reopened, id, () => { sends++; return { id: 'wrong' }; }, raw => { assert.equal(raw, 'known'); observations++; tick += 2; return { elapsed: 2 }; }, { monotonicNow: () => tick });
    assert.equal(sends, 0); assert.equal(observations, 1); assert.equal(result.detailWork[0].status, 'completed');
    assert.equal(result.submissions, state.submissions); assert.equal(result.activeTime, 102);
    const other = result.detailWork[1].id;
    state = reserveDetailSubmission(result, other); state = dispatchDetailSubmission(state, other); reopened.writeTraversal(state);
    state = recordDetailId(state, other, 'known-over-cap'); reopened.writeTraversal(state);
    const overCap = executeDurableDetail(reopened, other, () => { sends++; return { id: 'unsafe' }; }, raw => { assert.equal(raw, 'known-over-cap'); observations++; tick += 3; return { elapsed: 3 }; }, { monotonicNow: () => tick });
    assert.equal(sends, 0); assert.equal(observations, 2); assert.equal(overCap.detailWork[1].status, 'completed');
    assert.equal(overCap.activeTime, 105); reopened.close();
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('no-ID detail attempt blocks other detail and discovery work after SQLite recovery debit', () => {
  for (const boundary of ['reserved', 'dispatched']) {
  const { dir, path } = temp(); const d = DurableState.open(path); let sends = 0; let closed = false;
  try {
    let state = discovered();
    const [first, second] = state.detailWork;
    state = reserveDetailSubmission(state, first.id);
    if (boundary === 'dispatched') state = dispatchDetailSubmission(state, first.id);
    state = { ...state, recoveryPending: true, activeInterval: false };
    d.writeTraversal(state); d.close(); closed = true;
    const reopened = DurableState.open(path);
    try {
      resolveDurableRecoveryDebit(reopened, 1, 'synthetic interruption');
      assert.throws(() => executeDurableDetail(reopened, second.id, () => { sends++; return { id: 'bad' }; }, () => ({ elapsed: 0 })), /uncertain|refusing/i);
      assert.throws(() => executeDurableDiscovery(reopened, () => { sends++; return { id: 'bad' }; }, () => ({ result: { status: 'success', candidates: [] }, elapsed: 0 })), /uncertainty/i);
      assert.equal(sends, 0);
      assert.equal(reopened.readTraversal().submissions, state.submissions);
    } finally { reopened.close(); }
  } finally { if (!closed) d.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test('detail reservation uses shared cap, refuses duplicates, and dispatch does not send', () => {
  const { dir, path } = temp(); const d = DurableState.open(path); let sends = 0;
  try {
    let s = discovered(); const work = s.detailWork;
    s = reserveDetailSubmission(s, work[0].id);
    assert.equal(s.submissions, 2);
    assert.throws(() => reserveDetailSubmission(s, work[0].id), /pending/i);
    s = dispatchDetailSubmission(s, work[0].id);
    assert.equal(s.detailWork[0].status, 'dispatched');
    assert.equal(sends, 0);
    s = reserveDetailSubmission(s, work[1].id);
    assert.equal(s.submissions, 3);
    assert.notEqual(s.detailWork[0].attempts[0].id, s.detailWork[1].attempts[0].id);
    assert.throws(() => reserveDetailSubmission(s, 'missing'), /Submission limit reached/);
    d.writeTraversal(s); assert.deepEqual(d.readTraversal(), s);
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('detail dispatch is blocked by paused, cancelled, recovery, and time limits', () => {
  const base = reserveDetailSubmission(discovered(), discovered().detailWork[0].id);
  for (const patch of [{ paused: true }, { cancelled: true }, { recoveryPending: true }, { activeTime: 100 }]) {
    assert.throws(() => dispatchDetailSubmission({ ...base, ...patch }, base.detailWork[0].id), /stopped|unresolved/i);
  }
  assert.throws(() => dispatchDetailSubmission({ ...base, submissions: 4 }, base.detailWork[0].id), /limit/i);
  assert.doesNotThrow(() => dispatchDetailSubmission(base, base.detailWork[0].id));
  const emptyAttempts = { ...base, detailWork: base.detailWork.map((w, i) => i ? w : { ...w, attempts: [] }) };
  assert.throws(() => dispatchDetailSubmission(emptyAttempts, base.detailWork[0].id), /attempt/i);
  for (const attempt of [{ ...base.detailWork[0].attempts[0], id: 'wrong' }, { ...base.detailWork[0].attempts[0], status: 'dispatched' }]) {
    const malformed = { ...base, detailWork: base.detailWork.map((w, i) => i ? w : { ...w, attempts: [attempt] }) };
    assert.throws(() => dispatchDetailSubmission(malformed, base.detailWork[0].id), /attempt/i);
  }
  const pendingWithHistory = { ...discovered(), detailWork: discovered().detailWork.map((w, i) => i ? w : { ...w, attempts: [{ id: `${w.id}:attempt:1`, status: 'uncertain' }] }) };
  assert.throws(() => reserveDetailSubmission(pendingWithHistory, pendingWithHistory.detailWork[0].id), /pending/i);
});

test('corrupt detail checkpoint variants reject without changing stored payload', async (t) => {
  const base = discovered();
  const reserved = reserveDetailSubmission(base, base.detailWork[0].id);
  const variants = [
    ['pending work with attempts', { ...base, detailWork: base.detailWork.map((w, i) => i ? w : { ...w, attempts: [{ id: `${w.id}:attempt:1`, status: 'reserved' }] }) }],
    ['reserved work without attempts', { ...reserved, detailWork: reserved.detailWork.map((w, i) => i ? w : { ...w, attempts: [] }) }],
    ['duplicate attempt IDs', { ...reserved, detailWork: reserved.detailWork.map(w => ({ ...w, attempts: [{ id: 'duplicate', status: 'reserved' }] })) }],
    ['cross-owner attempt ID', { ...reserved, detailWork: reserved.detailWork.map((w, i) => i ? { ...w, status: 'reserved', attempts: [{ id: reserved.detailWork[0].attempts[0].id, status: 'reserved' }] } : w) }],
    ['malformed ordinal', { ...reserved, detailWork: reserved.detailWork.map((w, i) => i ? w : { ...w, attempts: [{ ...w.attempts[0], id: `${w.id}:attempt:2` }] }) }],
    ['unresolved earlier reservation', { ...reserved, submissions: reserved.submissions + 1, detailWork: reserved.detailWork.map((w, i) => i ? w : { ...w, status: 'dispatched', attempts: [{ id: `${w.id}:attempt:1`, status: 'reserved' }, { id: `${w.id}:attempt:2`, status: 'dispatched' }] }) }],
    ['malformed attempt ID', { ...reserved, detailWork: reserved.detailWork.map((w, i) => i ? w : { ...w, attempts: [{ ...w.attempts[0], id: '' }] }) }],
    ['duplicate work IDs', { ...base, detailWork: [base.detailWork[0], { ...base.detailWork[1], id: base.detailWork[0].id }] }],
    ['duplicate candidate observation IDs', { ...base, candidates: [...base.candidates, { ...base.candidates[0] }] }],
    ['resolved unverified detail gap', { ...base, detailGaps: [{ workId: base.detailWork[0].id, identity: base.detailWork[0].identity, observationIds: [...base.detailWork[0].observationIds], status: 'resolved' }] }],
  ];
  for (const [name, payload] of variants) await t.test(name, () => {
    const { dir, path } = temp(); let d = DurableState.open(path);
    try {
      d.writeTraversal(base); d.close(); d = undefined;
      const db = new DatabaseSync(path); const raw = JSON.stringify(payload);
      db.prepare('UPDATE traversal SET payload=?').run(raw); db.close();
      assert.throws(() => DurableState.open(path), /Corrupt traversal checkpoint/);
      const check = new DatabaseSync(path);
      assert.equal(check.prepare('SELECT payload FROM traversal').get().payload, raw); check.close();
    } finally { try { d?.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
  });
});

test('reducer rejects duplicate detail work IDs', () => {
  const state = discovered();
  const work = { ...state.detailWork[0], identity: 'verified:same', id: 'detail:verified:same' };
  const duplicate = { ...state, detailWork: [work, { ...work, observationIds: [...work.observationIds] }] };
  assert.throws(() => reserveDetailSubmission(duplicate, work.id), /duplicate|identity/i);
});

test('invalid persisted detail reservation checkpoint fails closed', () => {
  const { dir, path } = temp(); const d = DurableState.open(path);
  try {
    const s = discovered(); d.writeTraversal(s);
    const db = new DatabaseSync(path);
    db.prepare('UPDATE traversal SET payload=?').run(JSON.stringify({ ...s, detailWork: [{ ...s.detailWork[0], status: 'bogus' }, s.detailWork[1]] })); db.close();
    d.close();
    assert.throws(() => DurableState.open(path), /Corrupt traversal checkpoint/);
  } finally { try { d.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
});

test('known-ID detail-only recovery settles moving time before active-time gate and never resends', () => {
  const { dir, path } = temp(); const d = DurableState.open(path); let sends = 0; let polls = 0; let samples = 0;
  try {
    const base = discovered(); const workId = base.detailWork[0].id;
    let state = { ...base, queue: [], cells: Object.fromEntries(Object.entries(base.cells).map(([key]) => [key, { outcome: 'empty' }])) };
    state = reserveDetailSubmission(state, workId); state = dispatchDetailSubmission(state, workId);
    state = { ...state, activeTime: 99, limits: { ...state.limits, activeTime: 100 }, detailWork: state.detailWork.map((w, i) => i ? w : { ...w, attempts: w.attempts.map(a => ({ ...a, knownId: 'known' })) }) };
    d.writeTraversal(state);
    const atCap = executeDurableDetail(d, workId, () => { sends++; return { id: 'wrong' }; }, () => { polls++; return { elapsed: 0 }; }, { monotonicNow: () => samples++ === 0 ? 4 : 5 });
    assert.equal(atCap.activeTime, 100); assert.equal(polls, 1); assert.equal(sends, 0);
    d.transitionTraversal(value => ({ ...value, activeTime: 101 }));
    const result = executeDurableDetail(d, workId, () => { sends++; return { id: 'wrong' }; }, () => { polls++; return { elapsed: 1 }; }, { monotonicNow: () => samples++ === 0 ? 5 : 6 });
    assert.equal(polls, 2); assert.equal(sends, 0); assert.equal(result.detailWork[0].status, 'completed');
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('detail-only execution accounts active time and recovered reservation is uncertain without resend', () => {
  const { dir, path } = temp(); const d = DurableState.open(path); let sends = 0; let now = 0;
  try {
    const base = discovered(); const workId = base.detailWork[0].id;
    let state = { ...base, queue: [], cells: Object.fromEntries(Object.entries(base.cells).map(([key]) => [key, { outcome: 'empty' }])) };
    state = reserveDetailSubmission(state, workId); d.writeTraversal(state);
    assert.throws(() => executeDurableDetail(d, workId, () => { sends++; return { id: 'unsafe' }; }, () => ({ elapsed: 0 }), { monotonicNow: () => now }), /persisted|refusing/i);
    assert.equal(sends, 0); assert.equal(d.readTraversal().submissions, 2);
    assert.equal(d.readTraversal().detailWork[0].status, 'uncertain');
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('detail observation failure globally blocks detail and discovery sends but permits known-ID observation', () => {
  const { dir, path } = temp(); const d = DurableState.open(path); let sends = 0;
  try {
    const base = discovered(); const workId = base.detailWork[0].id; const secondId = base.detailWork[1].id;
    const state = { ...base, queue: [], cells: Object.fromEntries(Object.entries(base.cells).map(([key]) => [key, { outcome: 'empty' }])) };
    d.writeTraversal(state);
    assert.throws(() => executeDurableDetail(d, workId, () => { sends++; return { id: 'known-id' }; }, () => { throw new Error('observation failed'); }, { monotonicNow: () => 0 }), /observation failed/);
    const uncertain = d.readTraversal();
    assert.equal(uncertain.detailWork[0].status, 'uncertain');
    assert.deepEqual(uncertain.detailGaps[0], { workId, identity: uncertain.detailWork[0].identity, observationIds: uncertain.detailWork[0].observationIds, status: 'unresolved' });
    assert.throws(() => executeDurableDetail(d, secondId, () => { sends++; return { id: 'second-id' }; }, () => ({ elapsed: 0 }), { monotonicNow: () => 0 }), /global uncertainty/i);
    assert.throws(() => executeDurableDiscovery(d, () => { sends++; return { id: 'discovery-id' }; }, () => ({ result: { status: 'empty' }, elapsed: 0 })), /global uncertainty/i);
    assert.equal(sends, 1);
    const recovered = executeDurableDetail(d, workId, () => { sends++; return { id: 'duplicate' }; }, () => ({ elapsed: 0 }), { monotonicNow: () => 0 });
    assert.equal(recovered.detailWork[0].status, 'completed');
    assert.equal(sends, 1);
    const valid = d.readTraversal();
    const duplicateGapState = { ...valid, detailGaps: [...valid.detailGaps, { ...valid.detailGaps[0], status: 'resolved' }] };
    assert.throws(() => d.writeTraversal(duplicateGapState), /Corrupt traversal checkpoint/);
    assert.deepEqual(d.readTraversal(), valid);
  } finally { d.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('detail completion never resolves unrelated uncertainty gaps', async () => {
  const { completeDetailWork } = await import('../dist/traversal.js');
  const base = discovered(); const workId = base.detailWork[0].id;
  let state = reserveDetailSubmission(base, workId); state = dispatchDetailSubmission(state, workId);
  state = { ...state, detailWork: state.detailWork.map((w, i) => i ? w : { ...w, identity: 'verified:one', attempts: w.attempts.map(a => ({ ...a, knownId: 'detail-id' })) }), gaps: [{ cellKey: 'detail:unrelated', cause: 'uncertain', status: 'unresolved' }] };
  const completed = completeDetailWork(state, workId, 'detail-id');
  assert.equal(completed.gaps[0].status, 'unresolved');
});
