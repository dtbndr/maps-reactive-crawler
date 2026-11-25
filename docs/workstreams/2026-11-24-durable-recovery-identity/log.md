# Durable Recovery and Result Identity Workstream Log

Opt-ins: playback=on, external review=on
Isolation: worktree — branch ws/durable-recovery-identity
Pre-flight: clean
Operator approved splitting the discovery gate into A0 foundation and A integration; the original gate criteria remain mandatory.

## A3 oracle fac20966 — cancellation logical-state regression

- Baseline: `aba59b2` (A3 baseline); reported full-check result was 135/135 tests passing.
- Regression: changed the fresh-process rejected-execution assertion to compare `readTraversal()` before and after rejection. It now verifies logical traversal state, rather than SQLite main-file bytes (which are not a reliable logical-state assertion).
- GREEN: `e3ba4f2` is the reported fixed-code comparison for this target regression. The assertion is present in the current test change; fresh build/full check still required below.
- Historical RED availability: no saved RED report was found in this worktree. Do not claim a historical RED. The target regression RED was reported against prior code, but no captured output is available here.
- Related A3 evidence reported by parent: submission-count corruption RED vs `7c6bb45`, GREEN `ac74944`; known-ID guard reproduction reference `149bb97b`, with RED not explicitly captured. These are parent-reported evidence, not independently reconstructed in this worktree.
- Blocker: the required captured/reconstructed RED evidence is missing. A3 acceptance gate is not claimed as passed.
