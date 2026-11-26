# Slice B2 report: typed timed-boundary stops

## RED evidence

Added `test/operator-stop-boundary.test.mjs` with assertion-level behavior tests for typed active-time and recovery stops. Built before the focused run as required.

- Build: `mise exec -- npm run build` — exit 0.
- Focused RED: `mise exec -- node --test test/operator-stop-boundary.test.mjs` — exit 1, 2 tests failed.
- `active-time boundary emits a typed stop even when unresolved gap is also present`: assertion validation returned false; actual was generic `Error: Active-time limit reached before cell admission`, expected `DurableStopError` with `reason === 'active-time-limit'`.
- `recovery accounting boundary emits a typed stop`: assertion validation returned false; actual was generic `Error: Recovery accounting is unresolved`, expected `DurableStopError` with `reason === 'recovery-pending'`.

Both failures were behavioral assertion failures after successful build and module loading, not scaffolding/import failures. This section is captured before production edits.

## Implementation and GREEN

Added `DurableStopError` with explicit `active-time-limit` and `recovery-pending` reasons at the durable discovery/detail execution boundaries. Limit and recovery guards produce typed expected exits directly; normal callback, clock, transition, and settlement exceptions are not inferred to be stops. An isolated unresolved gap overlapping the active-time cap is covered by the active-time test.

- Rebuild: `mise exec -- npm run build` — exit 0.
- Focused GREEN: `mise exec -- node --test test/operator-stop-boundary.test.mjs` — exit 0, 2/2 tests passed.
- Full check: `mise exec -- npm run check` — exit 0; typecheck, 268/268 tests, and build passed. Complete output retained in `full-check-B2.out`.
- `git diff --check` — exit 0.

Existing focused durable discovery coverage characterizes failed monotonic/transition settlement behavior and confirms the active interval remains true for explicit recovery. This slice does not enable shared operator execution, CLI or status projection. No external or paid actions were performed.

## Independent review follow-up at `d4a8fe2`

Added controlled-clock discovery characterization proving that a callback failure and an ordinary traversal-transition failure remain the same ordinary `Error` instances when cleanup accounting reaches the active-time cap. Added a boundary case where a typed active-time stop is pending but cleanup settlement fails: the settlement error is surfaced, the failed debit remains unapplied, and `activeInterval` remains true for explicit recovery. Existing discovery stop assertions now verify exported `DurableStopError` class identity as well as the reason.

The detail-reservation active-time typed exit was removed. The supported operator path in this slice is discovery-only, and the immediately preceding version used an ordinary `Error` for this detail guard; retaining a newly typed detail exit was unnecessary scope. Discovery typed exits remain unchanged.

- Focused baseline after adding the characterization assertions but before changing production source: build passed; 5/5 tests passed, establishing these are preserved-behavior tests rather than fabricated RED.
- Focused verification after the minimal detail-exit revert: `mise exec -- npm run build && mise exec -- node --test test/operator-stop-boundary.test.mjs` — exit 0, 5/5 passed.
- Full check: `mise exec -- npm run check` — exit 0, 271/271 tests, typecheck and build passed. Full output retained in `full-check-B2-followup.out`.
- `git diff --check` — exit 0.

The original B2 report above records the two assertion-level RED failures and their expected/actual outcomes. A separate raw/standalone original RED output was not found in the repository or available session artifacts; this follow-up does not recreate or represent a new run as historical RED. No shared execution or external/paid action was performed.
