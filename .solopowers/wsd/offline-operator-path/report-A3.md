# Slice A3 implementation report

## Scope

Slice A3 production acquisition was added in `82f9b93` (`src/durable-state.ts`: `DurableState.openBound`). This review follow-up corrects the A3 test coverage and evidence record only; it makes no additional production change.

## Added coverage

- Dead-owner clean-pause acquisition calls `recordDurableCleanPause` and then acquires through the bound API; it verifies clean-pause evidence and non-interrupted state survive, rather than hand-writing pause evidence.
- DELETE and WAL tests kill a subprocess during an uncommitted transaction after dirty-page spill. DELETE validates the SQLite hot-journal magic and original page records, then confirms independently opening the copied fixture for recovery changes its main database pages. WAL validates its header, at least one complete frame and an absent commit marker on the last frame. Each recovered baseline is compared with mismatch acquisition for logical checkpoint, owner, traversal, active interval, recovery marker, and limits. The tests do not use a post-return callback as a send witness; bound acquisition has no send callback or execution integration, so these tests establish state preservation only.
- Two fixture files at distinct paths are loaded from disk; their exact-byte SHA-256 identities are used to create and open the same checkpoint.
- The original `82f9b93` production addition and A2's separately accepted exception for missing historical RED are recorded separately. A2's exception does not waive A3's RED gate.
- The changed files are `test/operator-binding.test.mjs`, `.solopowers/wsd/offline-operator-path/progress.md`, and `.solopowers/wsd/offline-operator-path/report-A3.md`. No provider calls or external actions were performed.

## RED evidence

The available original worker report and repository/session artifacts contain no original pre-implementation A3 RED capture. The review identified coverage defects in tests that passed on their first run; the revised tests are corrected characterization/preservation evidence, not historical RED. Reconstruction or simulated crash fixtures do not establish historical RED. The A2 operator-approved exception is separate and does not apply to A3; the required A3 RED evidence remains unavailable. No behavior change or further production fix was made. Evidence is limited to synthetic SQLite behavior on the tested local setup, not provider execution or broader platform guarantees.

## Verification

- Post-review commands and results are listed in the follow-up section of this report after validation.
- Tests use synthetic local databases only. No provider calls were made.

## Follow-up validation

- `mise exec -- npm run build && mise exec -- node --test test/operator-binding.test.mjs` — passed; focused suite 8/8.
- `mise exec -- npm run check` — passed; typecheck, full suite 249/249, and build.
- Crash fixtures verify a valid hot DELETE rollback journal with original page records and main-file changes after independent rollback recovery, and a valid WAL with at least one uncommitted frame (no final commit marker).
