# Milestone 2 — Offline reactive vertical slice

- Implement pure grid geometry, a single deterministic reactive scheduler, geographic/work bounds and a fixture-backed provider interface.
- Implement transactional local SQLite checkpoints, place deduplication, failure states, cancellation and resume.
- Connect a thin CLI and library API. Add synthetic end-to-end tests demonstrating seed → results → neighbors → bounded stop → restart/export.

**Exit:** reproducible, credential-free happy-path tests; explicit partial-failure and coverage behavior.
