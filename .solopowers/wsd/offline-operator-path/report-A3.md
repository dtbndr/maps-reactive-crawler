# Slice A3 implementation report

## Scope

Added characterization for the approved A3 existing-checkpoint acquisition contract. No production changes were needed: the current bound acquisition behavior passed the added cases.

## Added coverage

- Dead-owner clean-pause acquisition preserves `paused`, clean pause evidence, `activeInterval: false`, and `recoveryPending: false`, while acquiring ownership.
- Mismatched fixture acquisition is exercised against genuine killed-process SQLite crashes in both DELETE-journal (hot journal) and WAL modes. Each case starts with a committed stale owner and active-interval marker, then kills a child process during an uncommitted transaction. The test verifies the crash sidecar exists, copies the crash database and available sidecars to a distinct baseline path, lets SQLite recover that baseline, and compares logical checkpoint, owner, and traversal state after mismatch acquisition against it. It checks the active interval and stale owner remain represented, uncommitted writes are absent, traversal payload (including limits/markers) is unchanged, and a caller's post-acquisition send callback is not reached.
- Existing same-fixture-bytes/different-path test retained as characterization; it establishes matching byte-derived identity across paths, not historical RED.

## RED evidence

No historical pre-fix behavioral RED was established for these added cases. The implementation existed before the tests and the focused suite passed on its first run, so these are characterization/preservation tests, not RED claims. No intentional behavior change or production fix was required. This does not claim behavior on real provider calls or beyond the specified local SQLite scenario.

## Verification

- `mise exec -- npm run build && mise exec -- node --test test/operator-binding.test.mjs` — build passed; focused tests passed 8/8, 0 failed.
- `mise exec -- npm run check` — exit 0; typecheck, tests (249/249), and build passed.

The focused suite includes the genuine crashed DELETE and WAL fixture cases; their dedicated runs passed. Tests use synthetic local databases only. No provider calls were made.

## Changed files

- `test/operator-binding.test.mjs`
- `.solopowers/wsd/offline-operator-path/progress.md`
- `.solopowers/wsd/offline-operator-path/report-A3.md`

No staged files were present before this work. No commit had been made at report creation time.
