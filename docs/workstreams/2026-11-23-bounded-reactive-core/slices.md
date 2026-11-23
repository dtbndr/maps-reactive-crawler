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
- Surface `complete`, `partial_empty_success`, `partial_failed`, `partial_unrecognized`, `partial_limit`, `partial_cancelled`, and `partial_gaps` with cell outcomes, queue, counters, blocked work and gaps. Empty success is a cell outcome even when other work continues; limit and cancellation stop reasons retain gap details, and exhausted queue with gaps is never complete. No exhaustive coverage or strict returned-place containment claim.
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
