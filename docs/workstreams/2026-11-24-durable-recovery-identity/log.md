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
- Related A3 evidence reported by parent: submission-count corruption RED vs `7c6bb45`, GREEN `ac74944`; known-ID guard reproduction reference `149bb97b`, with RED not explicitly captured. These are parent-reported evidence, not independently reconstructed in this worktree.
- Blocker: the required captured/reconstructed RED evidence is missing. A3 acceptance gate is not claimed as passed.
