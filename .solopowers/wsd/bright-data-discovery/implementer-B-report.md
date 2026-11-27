# Implementer B — Slice B

## Test Evidence
- Baseline: `mise exec -- npm run check` passed; `mise exec -- npm run build && mise exec -- node --test test/durable-discovery.test.mjs test/durable-recovery.test.mjs` passed (41/41).
- RED command before implementation: `mise exec -- npm run build && mise exec -- node --test test/durable-discovery.test.mjs`.
- RED failure excerpt: `SyntaxError: The requested module '../dist/durable-discovery.js' does not provide an export named 'executeDurableDiscoveryAsync'`.
- Why this is behavioral RED: the requested awaitable execution boundary does not exist; the new test verifies persisted dispatch before send continuation and ID persistence before observation continuation, while retaining the sync interface.

## Rulings
- Ruling: expose an explicit `executeDurableDiscoveryAsync` entry point alongside the existing sync function — async callables cannot safely be passed into the synchronous interface, and changing the sync signature breaks fixture callers; cost if wrong: minor public API rename/refactoring.

## Implementation
- Added an additive `executeDurableDiscoveryAsync` API accepting synchronous or promise-returning send/observe callbacks; existing synchronous interface and callers are unchanged.
- Async execution awaits submission and observation callbacks only after durable reservation/dispatch and known-ID persistence respectively, and uses the existing monotonic active-time settlement model.
- Added a deterministic pending-promise test asserting dispatch state before send proceeds and persisted ID before observation proceeds.

## Validation
- GREEN: `mise exec -- npm run build && mise exec -- node --test test/durable-discovery.test.mjs` — 40 passed, 0 failed.
- Full required check: `mise exec -- npm run check` — passed (typecheck, all tests, and build).
- `git diff --check` — passed.
- Baseline focused verification: `mise exec -- npm run build && mise exec -- node --test test/durable-discovery.test.mjs test/durable-recovery.test.mjs` — 41 passed, 0 failed.

## Self-review and carry-forward
- Not all Slice B tasks are implemented. Persisted restart-meaningful wall-clock observation deadlines/budgets, timestamp validation, durable exhaustion disposition, cancellation/late-success races, and async fresh-process crash/hung-request coverage remain unimplemented. The async entrypoint addresses the missing await boundary and ordering only; do not treat this as completed Slice B acceptance.
- Async implementation currently mirrors the existing synchronous state machine. Duplication is localized but raises maintenance risk if lifecycle rules change independently.
- No staged files remain after commit; Slice changes are limited to the async implementation and its focused behavioral test plus this report.
- Commit: `0902329 feat: add async durable discovery execution`.

Status: DONE_WITH_CONCERNS — async durable dispatch boundary is implemented and fully checked, but the explicit persisted epoch/budget, exhaustion, and async recovery/race acceptance tasks remain outstanding.
