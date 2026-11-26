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
