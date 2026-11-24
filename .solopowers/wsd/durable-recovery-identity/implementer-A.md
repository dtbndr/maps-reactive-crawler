# Slice A implementer report

**Status: IN PROGRESS — Slice A acceptance is not complete.**

## Incremental implementation

Added deterministic replay identities to traversal attempts. Each attempt now carries a stable `workId` derived from its cell key and a distinct ordinal attempt ID. Both initial reservation and authorized resend use the same identity rule. Added a focused test covering initial identity, uncertainty parking, and distinct resend identity.

### TDD evidence

- Baseline build before test: `mise exec -- npm run build` — passed.
- RED: `mise exec -- npm run build && mise exec -- node --test test/durable-discovery.test.mjs` — initially the test had an import error (`createGeometry` is not exported); corrected test setup using existing `validateGeometry`; rerun failed as intended because attempt ID was `undefined`.
- GREEN: after adding IDs to `Attempt`, reservation and resend: build and focused test passed.

## Incremental durable traversal persistence

Added a separate durable traversal payload and methods to initialize, read, write, and atomically transition it under SQLite transactions. A focused test exercises reopen persistence of queue state, attempts and submission counter.

- RED: build passed; focused durable discovery test failed with `TypeError: state.writeTraversal is not a function`.
- GREEN: after implementation, `mise exec -- npm run build && mise exec -- node --test test/durable-discovery.test.mjs` passed (2 tests).
- Full verification: `mise exec -- npm run check` passed (65 tests, typecheck and build).

## Further atomicity and process-death evidence

Added a failure-injection test confirming a thrown reducer leaves the previous traversal state unchanged, and a fresh child-process exit/reopen test at the after-reservation/before-dispatch boundary. Child exits without calling `close`; the parent reopens and verifies reserved attempt identity and submission count.

- RED/GREEN: build ran before focused test. The new rollback test passed on the existing SQLite transaction implementation (characterization); fresh-process reserved-state recovery passed after adding the child harness.
- `mise exec -- npm run build && mise exec -- node --test test/durable-discovery.test.mjs` — passed (4 tests).
- `mise exec -- npm run check` — passed (67 tests, typecheck and build).

## Durable executor transition characterization

Added focused persistence coverage that executes reservation, dispatch, known-ID recording, and inspects the resulting durable attempt and running cell. This test uses generic `transitionTraversal` reducers; it does not introduce a production executor API or prove that those transitions are coupled to an external send.

- Build before focused tests; `mise exec -- npm run build && mise exec -- node --test test/durable-discovery.test.mjs` passed (5 focused tests).
- `mise exec -- npm run check` passed (68 tests, typecheck and build).

## Acceptance still outstanding

Slice A remains a full restartable discovery gate. Current work does not implement durable traversal serialization, atomic intents/ID/application markers, independent synthetic send ledger, fresh-process crash matrix, exactly-once application assertions, or uncertainty isolation scenarios. A0's generic checkpoint API does not yet persist traversal state. Therefore no durable recovery claim is made. No scope was reduced and no provider calls were made.

## Validation

- `mise exec -- npm run build` — passed before and after change.
- `mise exec -- node --test test/durable-discovery.test.mjs` — passed after change.
- `mise exec -- node --test test/fixture-driver.test.mjs && mise exec -- npm run check` — invoked; check output was truncated by context mode after typecheck and test startup, so full completion is not independently established here.

## Limitations / next step

Continue Slice A incrementally: durable serialization for traversal state and atomic transitions, then durable send/ID/apply boundaries and independent ledger crash harness; preserve the original seven-boundary gate and all exact assertions. The crash-time active-time policy remains conservative/paused; this change does not implement time accounting. The broad full-check command should be rerun with concise summarized output before commit.