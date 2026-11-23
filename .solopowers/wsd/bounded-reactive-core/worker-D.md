# Slice D worker report — serial synthetic fixture

## Implementation
Added `test/fixture-driver.test.mjs`, a small serial script runner over the existing traversal core. It accepts explicit elapsed-time entries and synthetic result/observation responses. It does not provide a second scheduler or contact a provider. Tests cover deterministic reruns, nonempty expansion and cell cap, empty/failure distinction, duplicate-only nonempty expansion, independent submission/time caps, and known observation after active-time limit. Coverage remains connected traversal only; results are synthetic and imply no provider behavior or exhaustive area coverage.

## TDD evidence
Initial implementation verification exposed a fixture contract mistake: `assert.equal(time.activeTime, 2)` failed (actual `1`) because core observation does not debit prior elapsed time; elapsed debit and observation duration are now explicit separate fixture fields. An empty-only trace expected `active_time` but got `empty`, correctly reflecting no remaining work; the trace was changed to leave a queued neighbor before the time cap.

Round 1's report overstated coverage: at that point extra fixture entries existed only for the cell cap, the duplicate assertion did not establish frontier growth, and coverage/terminal outcomes were underasserted. Do not treat those earlier statements as evidence.

Round 2 review correctly noted that the duplicate RED was due to an undersized fixture cell budget (five admitted cells), not a core regression. Increasing it to six exposed the newly discovered queued cell; no regression is claimed.

For fix round 3, preserved the existing driver and added an uncapped empty-seed exhaustion trace. It asserts terminal `partial_empty_success` / `empty`, no queued work, usage well below cells/submissions/time limits, and that a geometrically eligible distant cell remains unvisited because the empty result yields no connected frontier. This is preservation evidence, not a claimed pre-change RED: the driver was already fixed and this test was added afterward.

## Candidate classification follow-up
The new fixture assertion was first run against the report-only driver and failed with `TypeError: Cannot read properties of undefined (reading 'map')` at the exact `result.candidates.map(...)` assertion. The thin driver now exposes the core-produced candidate observations alongside its report, and the fixture checks inside/outside/unverified classifications. This preserves the same serial transitions and makes no classification decisions itself.

## Validation
- `npm run build >/dev/null && node --test test/fixture-driver.test.mjs` — passed (5 tests).
- `npm run check` — passed (typecheck, full test suite, build).
- No provider calls; synthetic fixtures only.
