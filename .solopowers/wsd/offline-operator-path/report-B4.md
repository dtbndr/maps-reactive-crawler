# Slice B4 report: cancel-only acquisition and cooperative cancellation

## RED evidence and limitation

Only the timer-abort contract has valid pre-production, assertion-level RED evidence. Before production edits, `mise exec -- npm run build` passed, then `mise exec -- node --test test/operator-cancel.test.mjs` failed on the timer case with a behavioral assertion: the test expected one submission after the first-send timer abort, but actual sends were five (`5 !== 1`, `test/operator-cancel.test.mjs:35`). Raw output is retained locally at `red-B4-timer.log`.

The other B4 behavior assertions were added after production edits and are GREEN coverage only; they are not historical RED evidence. They must not be represented as RED or characterization. Existing B1/B2/B3 retry, cap, recovery, and known-ID tests ran as preservation coverage, not as new B4 RED evidence. This misses the prompt's full per-contract RED gate. Per supervisor direction, B4 remains open pending independent review and operator disposition; no historical RED is reconstructed.

## Implementation and verification

Added fixture-less `DurableState.acquireCancelOnly(path)`. It opens one SQLite connection, validates the bound checkpoint schema, binding structure, and traversal payload on that connection inside the writer-claim transaction, checks owner liveness, reconciles an orphan active interval/reused stale owner to `recoveryPending`, claims ownership, then returns a constrained object exposing only `snapshot`, `cancel`, and `close`. Cancellation is guarded against an active interval and only changes the cancellation flag; it preserves recovery and unresolved retry/accounting state. `cancelCheckpoint` is an internal operator-module operation, not added to the package entry point.

The async executor checks `AbortSignal` before work and after each durable invocation's macrotask yield. Once an invocation has completed its callback/observation and interval settlement, cancellation closes the execution lease and performs durable cancellation through the cancel-only acquisition. Settlement errors continue to surface unchanged and do not become cancellation results.

Added 13 focused tests covering actual timer abort before a second otherwise-eligible submission, callback/observation completion and settled interval, pre-abort, orphan interval recovery/accounting preservation, paused state, live-owner and SQLite writer-claim refusal, malformed/unbound binding rejection, idle cancel, constrained interface, pending known-ID observation at both caps, refused unknown-ID authorization preservation, and settlement failure. The timer test is the only one with pre-production RED evidence.

Commands and outcomes:

- `mise exec -- npm run build` — passed.
- Individual `node --test --test-name-pattern ... test/operator-cancel.test.mjs` runs — passed for all 13 tests; the exact focused suite output is retained locally at `green-B4-focused.out`.
- `mise exec -- node --test test/operator-cancel.test.mjs` — passed, 13/13.
- First `mise exec -- npm run check` — failed. The single failure was `observation backoff persists across process death and changed delay policy` (`test/durable-retry-executor.test.mjs:177`): its spawned `executeDurableDiscovery` process threw `DurableStopError: Active-time limit reached after dispatch`, and the parent assertion saw `1 !== 42`. The failure was visible in the command output, but its raw output was overwritten by the successful retry and is not retained. Its cause is not established and is not labeled timing-sensitive or pre-existing.
- `mise exec -- node --test test/durable-retry-executor.test.mjs` — passed, 28/28.
- Retried `mise exec -- npm run check` — passed: typecheck, 293/293 tests, build. The retained `full-check-B4.out` contains the successful retry output.
- `git diff --check` — passed.

No provider, paid, external, publishing, or account actions were performed. No public package exports or response documents/exit codes were added. Residual gate: independent review is required, and missing per-contract historical RED requires operator disposition before B4 acceptance.
