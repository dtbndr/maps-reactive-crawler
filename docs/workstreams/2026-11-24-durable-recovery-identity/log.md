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
