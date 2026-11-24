# Durable Recovery and Result Identity Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Make the existing bounded traversal durably restartable and reconcile synthetic verified identities without losing provenance or gaps.

## Scope
**In scope:** Local SQLite, fixture-backed discovery and detail, transactional recovery, accounting, identity and synthetic fresh-process tests.

**Out of scope:** CLI/export, fuzzy matching, real providers, geocoding, paid calls, publishing and account changes. Do not assert provider idempotency, billing, lookup or exhaustive coverage.

## Key files
- `src/traversal.ts`, `src/index.ts`: existing deterministic traversal and geometry contracts.
- `test/fixture-driver.test.mjs`, `test/`: fixture driver and synthetic tests.
- `docs/research/bounded-crawl-recovery.md`: authoritative offline acceptance traces and accounting contract.
- `docs/milestones/02-offline-reactive-slice.md`: workstream boundaries.

## Architecture invariant
Preserve raw-nonempty expansion before deduplication, unique cell admission, existing deterministic geometry and independent limits. Apply a discovery result, its application marker, all distinct raw observations, cell outcome, neighbor admissions and associated detail fan-out and gap updates in one SQLite transaction; no committed intermediate application state is allowed. Stable local observation/work keys prevent replay duplication and are distinct from canonical place identity. Do not treat the current cell-oriented in-memory attempt shape as a complete persistence contract.

## Assumptions and design decisions
- One integrated workstream with sequential gates: recovery and minimum verified identity interact at atomic result and gap boundaries; rejecting a schema-only first workstream avoids a misleading milestone. If the restartable discovery gate proves too large, stop and seek operator approval to rescope; the smaller workstream must retain stable keys, raw observations, provenance and pending work/gaps and must not claim full identity or milestone completion.
- Use local SQLite, temporary on-disk databases and a fresh process for restart tests, not just serialization and same-process simulation. Node is pinned to 26; use its built-in SQLite support rather than add a package. One operator and serial executor; enforce exclusive checkpoint ownership for the executor lifetime, refusing a second process before any send. Unsupported schema versions and corrupt or untrustworthy checkpoints fail closed before dispatch. Test lock contention, release after process death, unsupported version and corruption. Schema layout, helpers and SQL representation are implementation discretion subject to invariants.
- Each work item and each attempt has a stable durable ID; associate acknowledgments, observations and application with those IDs, never global array position. A serial executor parks an isolated uncertain item outside the active slot without resolving its gap; it may advance another already-admitted item only when isolation and accounting are established. Global uncertainty or unbounded accounting blocks all new work. Recovering the parked item must not repeat dispatch or application.
- Raw observations are immutable and individually keyed by work/attempt and occurrence, so duplicate raw IDs never collapse. A verified canonical place owns at most one pending detail work item; unverified observations own separate detail items. Each detail item retains all original attempts. Duplicate verified observations arriving before reservation attach to the existing item; after reservation they attach without another send. Verified same-identity success resolves eligible detail gaps but cannot erase an uncertain attempt or its billing history, nor a discovery gap.
- Fixture-supplied identity must be explicitly verified to merge observations; names, coordinates and raw IDs alone do not establish identity. Unverified observations remain separate. Preserve source cells, original observations and inside/outside/unverified classifications. Verified same-identity detail success may reconcile detail gaps; different or uncertain identity cannot, and discovery gaps never disappear merely because another cell finds the place. Real identity mapping remains a provider-integration blocker.
- Persist reservation and increment submissions before a potentially billable send. On restart an intent without a durable ID is uncertain, including a possibly unsent intent; never blindly retry. Persist recovered ID and synthetic evidence/source/time linked to original intent before observation; keep the gap until verified completion. Skip is durable and visible. Approved resend records approval/rationale and finite resend ordinal, consumes a fresh submission slot, and leaves prior billing uncertainty and gap visible until verified result. Authorization is not provider safety.
- Persist operation-scoped retry ordinals and finite ceilings before retry; initial ordinal zero, no reset on restart or cap change. Known-safe synthetic observation retries consume retry allowance but no submission slot. New submissions, including detail and resends, each reserve a slot; only fixture-defined known-safe transients can be automatically retried. Unknown acceptance is never safe solely because allowance remains. Backoff is bounded.
- At the cell cap, already-admitted work can still reserve and dispatch; at the submission cap, the reservation that reaches the cap may dispatch, but no further submission or submission retry can be reserved. At submission or active-time exhaustion, known-ID observation and safe observation retries within their durable allowance continue without consuming submissions. At active-time exhaustion, no new admissions, reservations, dispatches or submission retries start. Active time is cumulative and monotonic while active, including waits/backoff, excluding intentional pause and downtime. Persist deltas and pause transitions. If the interval after the last checkpoint cannot be bounded on restart, block admissions and sends until operator supplies defensible conservative accounting. Cancellation may stop observation and never asserts remote cancellation. Cell cap does not strand admitted work. Cap increases preserve all totals.
- Isolated failures create cell or detail gaps and permit independent work when accounting remains trustworthy; global failure or corrupted checkpoint pauses all new work. Queue exhaustion with gaps is partial, never complete. Preserve stop reason, limits, counters, statuses and gap inventory; no claim of monetary bound.

### Implementation discretion
Internal helpers, schema names, fixture data, exact error text and annotations; no discretion to weaken the contracts above.

### Unresolved design blockers
None for synthetic offline behavior. Provider lookup, verification, retry, cancellation and billing contracts remain integration blockers and are not resolved here.

## Final verification
- [ ] `mise install`
- [ ] `mise exec -- npm ci`
- [ ] `mise exec -- npm run build` before `mise exec -- npm run check` (project tests, type/lint/format checks as configured); all required checks pass.

## Slices

For every slice: run `mise exec -- npm run build` before focused tests, before RED and GREEN observations, and immediately before the full `mise exec -- npm run check`, since tests import dist and check tests before building. Establish meaningful RED for intentional changes before implementation; for refactors capture before/after evidence and add characterization where needed. Record exact results, distinguish verified baseline failures, and commit only after slice verification. Final verification has no baseline waiver.

### Slice A: Durable discovery checkpoint
**Goal**: Restartable discovery with stable replay identities and provenance.

#### Tasks
- [ ] Add local durable state initialization, versioned schema and atomic transition persistence for traversal, queue, observations, intent, ID and counters. Test exclusive lock contention, release after process death, unsupported versions and corrupt checkpoints failing closed before any send.
- [ ] Characterize existing scheduler behavior before refactoring; introduce stable work/attempt IDs and parking of isolated uncertainty. On temporary on-disk databases, terminate and reopen in a fresh process after dequeue before reservation, at reservation, after send before ID, after ID persistence, during partial application writes before commit, and after commit before advancing. Use an independent durable synthetic send ledger outside the crawler checkpoint. Assert exact observations (including repeated raw IDs), queue, gaps, counters and send counts; rollback partial writes and apply committed result exactly once. Preserve observations durably for later detail fan-out; no detail work is required in this slice.
- [ ] Test parking uncertain A, advancing admitted B with established isolation, then re-observing A's already-persisted ID without duplicate dispatch or application. Global uncertainty blocks B. Recovered IDs and unknown-time accounting are tested in later slices.
- [ ] Preserve partial outcomes, raw-nonempty behavior, candidate classification and independent caps. Confirm no lost provenance; use synthetic data only.

#### Watch out
Durable intent may over-count unsent work. Ensure application marker and dependent state cannot diverge. No full canonicalization required at this gate.

#### Verification
`mise exec -- node --test test/fixture-driver.test.mjs` and new `test/durable-discovery.test.mjs`, plus full project check. Record the restartable discovery gate and assess whether rescoping requires operator approval.

#### Carry-forward
Durable discovery observations, replay keys, attempts, queue and accounting.

### Slice A1: Recovery controls
**Goal**: Persist bounded recovery decisions and honest stops.

#### Tasks
- [ ] Implement durable known-ID recovery evidence, retry and resend ordinals/ceilings, approvals, skip, cancellation and isolated/global failure handling according to the handoff. Verify recovered-ID evidence persists before observation, observation retry increments only its ordinal, and allowances survive restart and cap changes.
- [ ] Test last reserved slot dispatch at the cap in the same uninterrupted execution. Separately crash after reservation before durable ID and assert restart does not dispatch or blindly resend, regardless of the independent fixture send ledger. Test fresh-process restart for admitted dispatch at cell cap, observation retry at submission cap without submission increments, fresh reservation for approved resend and cancellation.
- [ ] Test parked A recovered by durably recording authoritative synthetic ID evidence before observation; B can advance only with isolation and trustworthy accounting, and A is never dispatched twice.

#### Watch out
Never claim remote cancellation or billing certainty; skip and approval do not erase a gap. Corrupt/untrusted checkpoints block new work.

#### Verification
`mise exec -- node --test test/durable-recovery.test.mjs` and full project check; assert durable state and fixture send counts.

#### Carry-forward
Operation-scoped durable recovery control usable for detail work.

### Slice B: Durable active-time accounting
**Goal**: Preserve time limits safely across process failure.

#### Tasks
- [ ] Implement cumulative active-time checkpointing and fail-closed unbounded crash interval; preserve totals through pause, restart and limit changes.
- [ ] Test fresh-process restart with unbounded time blocking admission and dispatch of B until a conservative debit is recorded, and known-ID observation retries after the time cap without submission increments.

#### Watch out
A cap stops new dispatches but does not abandon observation; cancellation is separate.

#### Verification
`mise exec -- node --test test/durable-time.test.mjs` and full project check.

#### Carry-forward
Conservative time accounting for discovery and detail.

### Slice C: Verified identity and detail recovery
**Goal**: Durable fixture-verified canonical identity and scoped gap reconciliation.

#### Tasks
- [ ] Add explicit verified synthetic keys and distinct unverified observations; preserve original source provenance and classifications, duplicate-only expansion and separate cell/detail gaps.
- [ ] Implement separately reserved and checkpointed detail work with durable fan-out and same-identity verified detail reconciliation only. Extend the discovery application transaction to include detail fan-out and related gaps atomically; test crash before commit and after commit before executor advance, asserting exact observations, queue, detail work, gaps, counters and independent send ledger.
- [ ] Test fresh-process interruption after discovery with A complete, B uncertain and C pending; duplicate verified observations before and after detail reservation; conflicting coordinate classifications per observation; same/different/unverified identity; same-identity completion resolving eligible detail gaps while preserving uncertain attempt history and discovery gaps; unresolved skip and queue exhaustion with gaps.

#### Watch out
Identity is not inferred from fixture names, coordinates or raw IDs. Never erase a discovery gap by finding a duplicate place.

#### Verification
`mise exec -- node --test test/durable-identity.test.mjs` plus full project check and final verification.

#### Carry-forward
Credential-free durable core and evidence for Workstream 3; provider mapping remains unverified.
