# Milestone 2 — Offline reactive vertical slice

- Implement pure grid geometry, a single deterministic reactive scheduler, geographic/work bounds and a fixture-backed provider interface.
- Implement transactional local SQLite checkpoints, place deduplication, failure states, cancellation and resume.
- Connect a thin CLI and library API. Add synthetic end-to-end tests demonstrating seed → results → neighbors → bounded stop → restart/export.

**Exit:** reproducible, credential-free happy-path tests; explicit partial-failure and coverage behavior.

## Provisional workstream sizing

These ordered workstreams and slice counts are historical provisional estimates, not actual effort accounting or blanket implementation authorization. Each workstream requires its own scope and approval. Tests accompany behavioral slices; the final workstream adds connected acceptance coverage. See the [bounded crawl and recovery handoff](../research/bounded-crawl-recovery.md) for detailed contracts and synthetic traces.

### Workstream 1 — Bounded reactive core (about 3–4 slices)

**Status: Workstreams 1–3 complete for the synthetic offline path.** Workstream 1: [brief](../workstreams/2026-11-23-bounded-reactive-core/brief.md). Workstream 2: [durable recovery and result identity brief](../workstreams/2026-11-24-durable-recovery-identity/brief.md) and [final log/review](../workstreams/2026-11-24-durable-recovery-identity/log.md). Workstream 3: [offline operator brief](../workstreams/2026-11-25-offline-operator-path/brief.md) and [final log/review](../workstreams/2026-11-25-offline-operator-path/log.md). Live provider and location integrations remain outside this milestone.

Build pure geometry, a single deterministic scheduler and synthetic fixture-backed provider behavior. Use a seed-anchored metre grid and practical finite JavaScript Number arithmetic: inclusive bbox comparisons on actual submitted coordinates and spherical haversine distance ≤ radius. Preflight invalid, pole and seam geometry; do not add arbitrary epsilon/buffer or round coordinates after checks. Given one coordinate seed and explicit geography, admit eligible cells, react to successful raw nonempty results before deduplication, and respect independent cell, submission and active-time limits. Separate cell eligibility from reliable inside/outside and unverified candidate classification, and empty success from failure. Model admission, reservation, uncertain submission and result application as distinguishable transitions. Do not claim strict containment or exhaustive coverage.

**Depends on:** Milestone 1 research handoffs. **Outcome:** reproducible in-memory traversal and bounded-stop tests. **Risk:** boundary and expansion semantics may imply coverage they cannot provide. No real provider or geocoder; fixtures are not evidence of provider behavior.

### Workstream 2 — Durable recovery and result identity (about 4–6 slices)

Make the same flow durable with transactional local SQLite checkpoints, retry and submission accounting, cancellation and resume. Deduplicate verified identities while preserving provenance; distinguish cell discovery gaps from candidate-detail gaps and reconcile only when justified. Exercise crash windows and failure states alongside their transitions, including uncertain submissions without blind retry and known-ID observation. Preserve durable retry allowances and fail closed where elapsed time cannot be bounded.

**Depends on:** Workstream 1. **Outcome:** synthetic interruption and restart tests demonstrate durable state, independent limits and honest partial outcomes. **Risk:** incorrect transaction or identity boundaries can lose work, repeat submissions or hide gaps. No claims of provider idempotency, billing guarantees or live recovery.

### Workstream 3 — Offline operator path and acceptance (about 3–4 slices)

Connect thin CLI and library surfaces, including status inspection, resume and provenance-bearing export. Before fixture collection, communicate the supplied seed coordinate and estimated limits. Test the credential-free seed → results → neighbors → bounded stop → restart/export path, including duplicate observations, cancellation, partial failure, gaps and explicit stop and coverage reporting. Specify and test whether boundaries constrain cell centers, returned places or both; do not claim strict place boundaries without reliable coordinates and filtering. Explain that expansion can miss disconnected areas and provider results may be incomplete; a drained queue does not imply exhaustive coverage.

**Depends on:** Workstreams 1 and 2. **Outcome:** the milestone's connected offline exit criteria are reproducible using synthetic fixtures. **Risk:** a successful demo could hide gaps or overstate coverage. Limit scope to the coordinate-based offline path; provider and location integrations remain later work.

The estimates total roughly 10–14 slices; recovery is the least certain and may warrant rescoping at brief time. Issue [#1](https://github.com/dtbndr/maps-reactive-crawler/issues/1) tracks the nonblocking boundary-reporting follow-up; it is not silently made a prerequisite for this milestone. Provider integration and geocoder selection remain open. No paid calls, publication or external account changes are authorized by this sizing.
