# Durable Recovery and Result Identity Workstream Log

Opt-ins: playback=on, external review=on
Isolation: worktree — branch ws/durable-recovery-identity
Pre-flight: clean
Operator approved splitting the discovery gate into A0 foundation and A integration; the original gate criteria remain mandatory.

## A3 oracle fac20966 — cancellation logical-state regression

- Baseline: `aba59b2` (A3 baseline); reported full-check result was 135/135 tests passing.
- Regression: changed the fresh-process rejected-execution assertion to compare `readTraversal()` before and after rejection. It now verifies logical traversal state, rather than SQLite main-file bytes (which are not a reliable logical-state assertion).
- Cancellation logical-state assertion: added after runtime review; no RED was captured for this assertion. Fresh build and full check passed 147/147 after correcting its fixture.
- Approved-resend targeting: the new regression failed against the previous implementation and passed at `e3ba4f2`; the full check then passed 136/136.
- Approval-consumption corruption: parent captured RED vs `7c6bb45` and GREEN at `ac74944`.
- Retrospective comparisons (oracle `a350e10d`): current known-ID rejection test fails against `3ab29d9`; terminal-state rejection test fails against `c17f68d`; multi-work approval test fails against `772c464`. These are not pre-implementation RED records.
- Retrospective allowance probe (oracle `5dc10e70`): after two uncertain synthetic sends and a raised global cap, `aba59b2` allowed a third send. At `6a92a46`, the wrapper ignored the higher ceiling and rejected at its default, but the direct reducer committed a third reservation with the raised ceiling; no third send was observed. At `eda8034`, both wrapper and reducer rejected widening without changing state or the two-send ledger.
- Operator accepted the documented retrospective comparisons as an explicit exception to missing pre-implementation RED timing. The final fresh full-check requirement is not waived; A3 remains subject to independent gate review.

## Slice C independent full gate — reviewer `7f91efa6`

- Gate commit: `80460e4`.
- Independent full gate: PASS; fresh build followed by full check passed 222/222 tests.
- Evidence boundary: tests use synthetic fixtures and establish offline durable behavior only. They do not verify real provider identity mapping, retry/idempotency, billing, lookup, or cancellation contracts; no live provider calls were made.
- Fail-closed boundary: origin legacy untagged blockers remain fail-closed; no assumption that legacy untagged data is trusted or safely recoverable.
- Remaining sequence from `slices.md`: Slice C is complete. Next workstream is Workstream 3/provider integration, requiring verified current provider contracts and operator approval before any paid calls. Remaining first-release work also includes the CLI/export and release readiness; provider and location integrations are not established by this offline gate.

## Final verification and independent review — reviewer `8ade8fe3`

- Reviewed tip: `33f44d3` (`33f44d32c1fd2cec197ab2a4371eedaedaaf97cb`); independent reviewer PASS.
- Required command sequence passed with exit 0: `mise install` → `mise exec -- npm ci` → `mise exec -- npm run build` → `mise exec -- npm run check`. Final check: 222/222 tests passed; typecheck and build passed.
- Evidence is synthetic-only and establishes offline behavior; it does not establish real-provider identity, lookup, retry/idempotency, billing or cancellation contracts. No live provider calls were made.
- Legacy caveat: do not interpret the legacy unconnected reactive loop as validated production behavior or as proof of provider semantics; the legacy source's disconnected batch/reactive paths remain ambiguous for those claims. Origin legacy untagged blockers remain fail-closed.
- End smoke: skipped (agent-verified; brief specifies None; no live/manual smoke was performed).
- P2/P3: none recorded.
- Final review: clean (at 33f44d3)
