# Slice C verification evidence

Status: implementation and tests staged for independent review; Slice C is not marked complete.

## Original RED provenance

No retained pre-implementation Slice C RED run was present in the repository or working tree when this continuation began. The newly available inspection test file was untracked, and its tests were run against the already-modified implementation. Therefore no behavioral RED is claimed, and no standing RED exception has been applied. The independent reviewer and supervisor must decide whether the missing historical RED evidence can be excepted after review.

During test authoring, one focused run failed because the new test's synthetic traversal had `submissions: 2` while containing no persisted attempts. The checkpoint validator correctly rejected that invalid fixture (`Corrupt traversal checkpoint`; process exit assertion expected 0 but got 1). The fixture was corrected to represent reached zero-valued caps without inconsistent submission accounting. This was test-fixture setup failure, not behavioral RED.

## Implemented verification coverage

The focused tests assert exact process-facing status documents for all simultaneous v1 conditions and headline precedence, a current-PID owner with an active interval, and stale ownership with genuine clean-pause evidence. They also cover missing paths without creation, CLI status/export, corruption and unsupported versions, inclusive bbox boundary and outside occurrence provenance, inside/outside/unverified classifications, verified-only grouping with separate unverified occurrences, and unchanged owner/traversal logical state after read-only export. Status and export use the single read-only snapshot returned by `readOnlyCheckpointSnapshot`.

## Commands and retained full logs

- `mise exec -- npm run build` — passed; [slice-c-build.log](slice-c-build.log).
- `mise exec -- node --test test/operator-inspection.test.mjs` — passed, 9/9; [slice-c-focused.log](slice-c-focused.log).
- `mise exec -- npm run check` — passed; 338/338 tests; [slice-c-check.log](slice-c-check.log) contains the complete command output.
- `git diff --check` — passed with no output; [slice-c-diff-check.log](slice-c-diff-check.log).

The checks were run locally with synthetic fixtures only; no provider or external actions were performed.
