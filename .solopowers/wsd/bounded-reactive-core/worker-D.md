# Slice D worker report — serial synthetic fixture

## Implementation
Added `test/fixture-driver.test.mjs`, a small serial script runner over the existing traversal core. It accepts explicit elapsed-time entries and synthetic result/observation responses. It does not provide a second scheduler or contact a provider. Tests cover deterministic reruns, nonempty expansion and cell cap, empty/failure distinction, duplicate-only nonempty expansion, independent submission/time caps, and known observation after active-time limit. Coverage remains connected traversal only; results are synthetic and imply no provider behavior or exhaustive area coverage.

## TDD evidence
Initial focused run (after build): failed at exact assertion `assert.equal(time.activeTime, 2)`; actual was `1`. The first draft used `elapsed` as the observation duration, but the core's `observeKnownId` does not itself debit prior elapsed time. The fixture contract was corrected to explicitly debit elapsed time first, then supply separate `observationElapsed`, matching the core API. A follow-up initial run failed at `assert.equal(time.stopReason, 'active_time')` (actual `empty`): a lone empty seed has no pending work, so it correctly reports the empty terminal distinction rather than a time stop. The scenario was corrected to produce a nonempty seed and queued neighbor, reach the cap, then finish its outstanding known observation. Final focused and full checks passed.

## Validation
- `npm run build >/dev/null && node --test test/fixture-driver.test.mjs` — passed (3 tests).
- `npm run check` — passed (typecheck, full test suite, build).
- No provider calls; synthetic fixtures only.
