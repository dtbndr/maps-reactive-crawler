import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometry, createTraversal, admitNextCell, reserveSubmission, dispatchSubmission, markUncertain, retryKnownIdObservation, updateTraversalLimits, authorizeResend, skipAttempt } from '../dist/index.js';
const geometry = validateGeometry({ seed: { latitude: 0, longitude: 0 }, spacing: 10, area: { type: 'bbox', south: -1, north: 1, west: -1, east: 1 } });
test('known-ID retry ordinal is durable state, does not consume submissions, and cap change cannot replenish it', () => {
 let s = createTraversal(geometry, { cells: 1, submissions: 1, activeTime: 10 });
 s = admitNextCell(s); s = reserveSubmission(s, '0,0'); s = dispatchSubmission(s, '0,0');
 s = markUncertain(s, '0,0', 'isolated', 'synthetic-id');
 s = retryKnownIdObservation(s, '0,0', 1);
 assert.equal(s.submissions, 1); assert.equal(s.attempts.at(-1).retryOrdinal, 1);
 s = updateTraversalLimits(s, { cells: 5, submissions: 10, activeTime: 100 });
 assert.throws(() => retryKnownIdObservation(s, '0,0', 5), /ceiling exhausted/);
});
test('approved resend persists rationale and skip leaves unresolved gap', () => {
 let s = createTraversal(geometry, { cells: 1, submissions: 2, activeTime: 10 });
 s = admitNextCell(s); s = reserveSubmission(s, '0,0'); s = dispatchSubmission(s, '0,0'); s = markUncertain(s, '0,0', 'isolated');
 s = authorizeResend(s, '0,0', 'operator approved synthetic duplicate risk');
 assert.equal(s.submissions, 2); assert.equal(s.attempts.at(-1).approval.rationale, 'operator approved synthetic duplicate risk');
 s = markUncertain({ ...s, attempts: s.attempts.map((a,i) => i === s.attempts.length-1 ? { ...a, status: 'dispatched' } : a) }, '0,0', 'isolated');
 s = skipAttempt(s, '0,0'); assert.equal(s.gaps.some(g => g.status === 'skipped'), true);
});
