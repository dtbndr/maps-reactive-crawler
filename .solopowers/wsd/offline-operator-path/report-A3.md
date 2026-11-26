# Slice A3 implementation report

## Scope

Slice A3 production acquisition was added in `82f9b93` (`src/durable-state.ts`: `DurableState.openBound`). This review follow-up corrects the A3 test coverage and evidence record only; it makes no additional production change.

## Added coverage

- Dead-owner clean-pause acquisition calls `recordDurableCleanPause` and then acquires through the bound API; it verifies clean-pause evidence and non-interrupted state survive, rather than hand-writing pause evidence.
- DELETE and WAL tests kill a subprocess during an uncommitted transaction after dirty-page spill. DELETE validates the SQLite hot-journal magic and original page records, then confirms independently opening the copied fixture for recovery changes its main database pages. WAL disables auto-checkpointing, commits an application-data update, then crashes during a subsequent uncommitted transaction. It validates committed WAL frames before later uncommitted frames, and verifies that recovery yields the committed application value while a standalone copy of the main file yields the old value. Each independently recovered baseline is compared with mismatch acquisition for logical checkpoint, owner, traversal, active interval, recovery marker, limits, and application rows. The tests do not use a post-return callback as a send witness; bound acquisition has no send callback or execution integration, so these tests establish state preservation only.
- A planted current-PID owner with the matching fixture identity reaches the live-owner check; acquisition refuses with `Database is already owned` and the logical application state remains unchanged. The mismatched-identity/live-owner ordering check is not claimed by this test.
- Two fixture files at distinct paths are loaded from disk; their exact-byte SHA-256 identities are used to create and open the same checkpoint.
- The original `82f9b93` production addition and A2's separately accepted exception for missing historical RED are recorded separately. A2's exception does not waive A3's RED gate.
- The changed files are `test/operator-binding.test.mjs`, `.solopowers/wsd/offline-operator-path/progress.md`, and `.solopowers/wsd/offline-operator-path/report-A3.md`. No provider calls or external actions were performed.

## RED evidence

The available original worker report and repository/session artifacts contain no original pre-implementation A3 RED capture. The review identified coverage defects in tests that passed on their first run; the revised tests are corrected characterization/preservation evidence, not historical RED. Reconstruction or simulated crash fixtures do not establish historical RED. The A2 operator-approved exception is separate and does not apply to A3; the required A3 RED evidence remains unavailable. No behavior change or further production fix was made. Evidence is limited to synthetic SQLite behavior on the tested local setup, not provider execution or broader platform guarantees.

## Verification

- Post-review commands and results are listed in the follow-up section of this report after validation.
- Tests use synthetic local databases only. No provider calls were made.

## Follow-up validation

- Earlier follow-up validation before the independent review passed `mise exec -- npm run build && mise exec -- node --test test/operator-binding.test.mjs` (8/8) and `mise exec -- npm run check` (typecheck, 249/249 tests, build); it did not establish committed application state in the WAL.
- `mise exec -- npm run build && mise exec -- node --test test/operator-binding.test.mjs` — passed; focused suite 8/8.
- `mise exec -- npm run check` — passed; typecheck, full suite (249/249), and build.
- `git diff --check` — passed.
- This follow-up adds the review-requested evidence: committed application state present in WAL before a later uncommitted transaction, distinct recovered and standalone-main logical state, preservation of the recovered baseline after mismatch refusal, and matching-identity current-PID refusal without logical mutation.
- The original pre-implementation A3 RED capture remains unavailable, as documented above. This follow-up does not fabricate or waive that required gate.
