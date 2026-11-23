# Slice D worker report — serial synthetic fixture

## Implementation
Added `test/fixture-driver.test.mjs`, a small serial script runner over the existing traversal core. It accepts explicit elapsed-time entries and synthetic result/observation responses. It does not provide a second scheduler or contact a provider. Tests cover deterministic reruns, nonempty expansion and cell cap, empty/failure distinction, duplicate-only nonempty expansion, independent submission/time caps, and known observation after active-time limit. Coverage remains connected traversal only; results are synthetic and imply no provider behavior or exhaustive area coverage.

## TDD evidence
Initial implementation verification exposed a fixture contract mistake: `assert.equal(time.activeTime, 2)` failed (actual `1`) because core observation does not debit prior elapsed time; elapsed debit and observation duration are now explicit separate fixture fields. An empty-only trace expected `active_time` but got `empty`, correctly reflecting no remaining work; the trace was changed to leave a queued neighbor before the time cap.

For follow-up fix round 1, added unused script entries beyond each cap and acceptance assertions before changing the driver. Focused pre-fix RED: cell-cap trace failed `assert.equal(first.submissions, 2)` (actual `1`) because driver was stopped incorrectly under the initial core-report check; duplicate test failed `assert.equal(Object.values(duplicate.cells).filter(cell => cell.outcome === 'nonempty').length, 2)` (actual cell outcome `queued` for the expected neighbor) since the fixture did not assert the actual expansion trace. Updated driver to consult `reportTraversal` and stop at submission/time decisions, while allowing already admitted queue entries to complete under cell cap. Updated duplicate trace to repeat an ID from a completed seed and assert two nonempty cells; cell-cap trace asserts queued/blocked neighbor evidence and unused response. The time trace asserts final submitted count and time stop after known observation. These are actual observed REDs; full check is GREEN below.

## Candidate classification follow-up
The new fixture assertion was first run against the report-only driver and failed with `TypeError: Cannot read properties of undefined (reading 'map')` at the exact `result.candidates.map(...)` assertion. The thin driver now exposes the core-produced candidate observations alongside its report, and the fixture checks inside/outside/unverified classifications. This preserves the same serial transitions and makes no classification decisions itself.

## Validation
- `npm run build >/dev/null && node --test test/fixture-driver.test.mjs` — passed (4 tests).
- `npm run check` — passed (typecheck, full test suite, build).
- No provider calls; synthetic fixtures only.
