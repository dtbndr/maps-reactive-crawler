# Bounded Reactive Core Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Build and test the bounded reactive traversal in isolation, ready for a later durable adapter.

## Scope
**In scope**
- Pure geometry, deterministic state transitions, serial synthetic fixtures and offline tests.

**Out of scope**
- SQLite, persistence, restart implementation, real provider, geocoding, CLI, paid calls, candidate detail fan-out and production identity deduplication. Do not port legacy code.

## Key files
- `docs/research/bounded-crawl-recovery.md`: normative geometry, accounting and outcome handoff; implement its applicable core contracts.
- `docs/milestones/02-offline-reactive-slice.md`: workstream boundaries.
- `src/`: new core and fixture driver modules; export through `src/index.ts`.
- `test/`: synthetic offline behavior tests.

## Architecture invariant
The core is a pure deterministic state machine: all time and fixture responses are explicit inputs; no clock, I/O, randomness, persistence or provider invocation inside transitions. Driver is serial and thin, supplies elapsed active time and scripted responses and applies transitions in order. State and commands must be serializable data so Workstream 2 can persist each boundary; no durability is claimed here.

## Assumptions and design decisions
- Apply the handoff input and numerical policy, including conservative indeterminate boundary handling, sphere and seed-anchored grid, inclusive edges and rejection of pole/seam contact. Reject approximating outward: it risks exceeding geography. Assumes floating error bounds can be established; fail closed otherwise.
- One confirmed coordinate, nonempty keyword, optional explicit country, exactly one radius or bbox and finite positive spacing and caps. No country inference or resolution. Seed must lie inside bbox. Follow handoff units and validation; reject invalid inputs before state creation.
- FIFO queue and fixed N, S, E, W neighbor order give deterministic cell-cap decisions. Integer row/column identity deduplicates cells. Only successful raw nonempty discovery expands, including duplicate-only or outside-only results; empty, failed, unrecognized and uncertain never expand. Retain candidate observations and provenance with inside/outside/unverified classification; canonical identity reconciliation belongs to Workstream 2.
- Cell cap counts unique admitted identities including seed; blocked eligible admissions are recorded, not silently forgotten. Already admitted cells can run. Submission cap reserves before each potentially billable send, including failed, empty and uncertain sends; equality permits the last slot. Active time includes waits and backoff, not deliberate pauses, and is supplied monotonically by the driver. Exhaustion blocks admissions and new submissions but not observation of already submitted work; account overrun. No spend guarantee follows from submission count.
- State transitions distinguish admission, reservation, dispatch uncertainty, known identifier and application of results. A reservation consumes a slot even if dispatch becomes uncertain; uncertain sends pause the item, never auto-resend. Explicit inputs model known-ID observation and operator skip or approved resend; resend needs a fresh reservation and remains subject to caps. These are in-memory representations, not crash safety or provider guarantees. Cancellation stops new work and preserves uncertainty. Global failures pause; isolated failures leave gaps while independent queued work may continue.
- Surface `complete`, `partial_empty_success`, `partial_failed`, `partial_unrecognized`, `partial_limit`, `partial_cancelled`, and `partial_gaps` with cell outcomes, queue, counters, blocked work and gaps. Empty success is a cell outcome even when other work continues. When an isolated failed or unrecognized cell leaves a gap and a limit later prevents remaining work, top-level outcome is `partial_limit`, with the earlier cell outcome, gap and outstanding queue or blocked admissions retained; never `complete`. Cancellation likewise retains gap details, and exhausted queue with gaps is `partial_gaps`, never complete. No exhaustive coverage or strict returned-place containment claim.
- Reopen these choices only if handoff changes or implementation evidence shows the numerical policy cannot be fulfilled. Alternatives of an effectful scheduler or porting legacy conflate decisions with I/O and recovery; neither is accepted.

### Implementation discretion
Internal module names, type names, fixture values and helper decomposition are flexible without changing these boundaries.

### Unresolved design blockers
None for drafting. Provider semantics and durable crash-time accounting remain downstream blockers, not claims of this workstream.

## Final verification
- [ ] `mise install`
- [ ] `mise exec -- npm ci`
- [ ] `mise exec -- npm run check`

## Slices

Each behavioral slice: establish meaningful failing tests before implementation; run focused tests and full project checks, report exact results and baseline failures, then commit. Final verification requires all checks pass.

### Slice A: Geometry and input contracts

**Goal**: Establish deterministic, conservative geometry independent of traversal.

#### Tasks
- [ ] Implement validation, grid identity and projection, radius/bbox preflight and membership, candidate classification per handoff, including conservative floating uncertainty.
- [ ] Test inclusive edges, high latitude, invalid and nonfinite inputs, seed outside bbox, pole/seam contact, tiny areas and uncertain boundary comparisons.
- [ ] Independently assert cell-center eligibility and reliable candidate classification for a known inclusive bbox edge (eligible / inside), a demonstrably outside point (not eligible / outside), and a radius comparison whose computed error interval straddles the boundary (not admitted / unverified). Retain outside and unverified candidates. The indeterminate fixture must exercise the actual numerical uncertainty policy, not merely a missing-coordinate candidate; also reject indeterminate pole/seam preflight. Do not add an outward epsilon.

#### Watch out
No outward epsilon or longitude wrap; place classification is not cell eligibility.

#### Verification
- Focused geometry tests; `mise install`, `mise exec -- npm ci`, `mise exec -- npm run check`.

#### Carry-forward
Validated configuration and pure cell and candidate geometry.

### Slice B: Deterministic admission and results

**Goal**: Model serial connected traversal without effects.

#### Tasks
- [ ] Define serializable state and pure commands for seed admission, FIFO admission and result application; fixed neighbor ordering and unique identities.
- [ ] Test raw nonempty, duplicate-only, empty, failed and unrecognized results, duplicate neighbors, candidate retention and isolated/global failures. Preserve gaps and honest coverage.

#### Watch out
Raw count precedes filtering; do not imply all geography was explored.

#### Verification
- Focused transition tests plus full project commands above.

#### Carry-forward
Pure traversal state and result transitions for accounting.

### Slice C: Limits and recovery-ready transitions

**Goal**: Enforce independent limits and preserve uncertainty without implementing persistence.

#### Tasks
- [ ] Model reservation, dispatch, uncertain send, known ID observation, explicit skip/resend, cancellation and elapsed-time input as separate transitions; validate illegal ordering and never auto-resend uncertain work.
- [ ] Test last submission slot, failed/empty/uncertain attempts, duplicate admission, blocked cells while admitted cells continue, time exhausted before work and during observation, cumulative totals across pause and cap increases, cancellation, global pause, gaps and stop outcomes.
- [ ] For each independent cap, keep the other caps nonbinding and assert legal and denied transitions, charged counters, remaining work and stop reason. Cell cap=2: seed admits one neighbor and blocks other eligible neighbors; the admitted neighbor still reserves, dispatches and applies a result, then report `partial_limit` with blocked work. Duplicate admission does not charge another cell.
- [ ] Submission cap=2: reserve and dispatch attempt 1, reserve and dispatch attempt 2 at equality; parameterize attempt 2 as empty success, isolated failure and uncertain send. Each costs exactly one reservation (S=2), never an extra charge on result application or observation; attempt 3 is denied, remaining work and gaps/uncertainty are visible, and a cap-prevented stop is `partial_limit`. Uncertain send must not auto-resend.
- [ ] Active-time cap=10: with a known ID outstanding, reaching 10 denies admissions and new reservations but permits observation and result application; debit observation time even beyond 10, without another submission charge. Assert queued or blocked work and `partial_limit` when the cap prevents it. Also test a cap reached before dispatch.
- [ ] In separate isolated-failure and unrecognized-result traces, leave a discovery gap, continue independent queued work until a cap prevents it, and assert `partial_limit`, the original distinct cell outcome and unresolved gap, remaining work and counters. Never report `complete`.

#### Watch out
Reservation is in-memory only; no crash recovery, provider cancellation or billing assurance is implied.

#### Verification
- Focused cap and transition tests plus full project commands above.

#### Carry-forward
Serializable transition boundaries and counters for durable recovery workstream.

### Slice D: Serial synthetic fixture traversal

**Goal**: Exercise the core end to end in isolation, without external services.

#### Tasks
- [ ] Add thin serial scripted fixture driver supplying explicit time and responses; no hidden scheduling decisions or provider assumptions.
- [ ] Test seed to raw results to neighbors to bounded stop, empty and failure distinctions, duplicate-only expansion, each independent cap and outstanding observation after time limit. Assert deterministic repeat runs and coverage caveats.

#### Watch out
Synthetic fixtures are not evidence of real provider behavior; restart/export belongs to later workstreams.

#### Verification
- Focused fixture tests plus full project commands above; inspect outcomes and counters against handoff traces.

#### Carry-forward
Offline deterministic core and fixture contract for Workstream 2; no durable recovery claim.
