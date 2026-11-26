# Slice B3 report: serial operator execution

## RED evidence

The initial build succeeded. The first focused run only exposed absent entry points and is not counted as behavioral RED. A minimal entry-point/setup scaffold (no scheduler or cap validation) was added solely to let the focused tests reach their behavioral assertions; that scaffold was discarded before implementation.

Command: `mise exec -- node --test test/operator-execution.test.mjs`
Exit status: 1. Raw output: `red-B3-behavior.log`.

Behavioral assertion failures:

- `start validates and preflights before serial fixture-backed discovery, leaving detail pending`: expected `kind === "completed"`, actual `"stub"` at `test/operator-execution.test.mjs:27` after valid fixture/config preflight and checkpoint initialization.
- `resume requires every supplied cap to strictly increase and rejects mixed updates atomically`: expected rejection for equal `submissions` cap, but promise resolved (`Missing expected rejection`) at `test/operator-execution.test.mjs:51`.

The fixture identity mismatch preservation test passed on the scaffold because existing `openBound` already validates fixture binding; it is characterization, not new behavior RED. The parked-only test was added as behavioral coverage and passed after implementation; it is not represented as historical RED. Thus the retained pre-implementation RED is specifically evidenced for start outcome and strict cap rejection, not every individual assertion in the final test file.

## Implementation and GREEN

Added shared asynchronous `start(options)` and `resume(options)` library operations. Start parses and validates the exact-byte fixture and configuration, calls synchronous preflight before checkpoint creation/collection, initializes the fixture-bound database, and executes serial fixture-backed discovery under its writer claim. Resume validates the fixture binding on the claimed connection before validating any supplied caps; every supplied cap must strictly increase, the complete update is validated before a single traversal write, and omitted caps are retained. Both use B1 eligibility before fixture lookup/timing, pass no retry policy, preserve unexpected callback errors, classify durable failed/unrecognized outcomes as partial, and return a typed blocked result for persisted blockers including parked-only isolated unknown-ID uncertainty. The adapter invokes only discovery execution; pending details remain persisted with zero attempts.

A private-module discovery override exists only for test injection and is not exported from the package entry point. It proves an initial thrown command remains an error, then a later successful writer claim returns a typed parked-only blocked result without a send, observation, active-time debit, or cleared authorization. A separate test proves an isolated parked gap does not prevent other eligible queued discovery work.

Focused tests cover preflight and pending detail, cell-cap admitted work draining, blocked frontier not promoted by cap increases, equal/decreased/mixed invalid cap updates remaining atomic, omitted caps and valid increases, fixture identity mismatch, simultaneous caps, known-ID observations at both submission/time caps, partial durable failures, original command error identity, parked-only blocked settlement, and other work alongside isolated parked uncertainty. Coverage added after the retained RED run is explicitly not claimed as pre-implementation RED.

Commands and results:

- `mise install` — passed.
- `mise exec -- npm ci` — passed.
- `mise exec -- npm run build` — passed.
- `mise exec -- node --test test/operator-execution.test.mjs` — passed, 8/8 tests.
- `mise exec -- npm run check` — passed: typecheck, 279/279 tests, build. Full output retained in `full-check-B3.out`.
- `git diff --check` — passed.

No provider, external, or paid actions were performed. No files are staged.

## Residual boundary

B3 does not implement B4 cancellation, B5 CLI, B6 status projection/post-release snapshots, or detail dispatch; the signal option is reserved for the approved later cancellation slice. Current async orchestration yields between completed durable core invocations. Historical assertion-level RED does not exist for every final test assertion, as disclosed above.
