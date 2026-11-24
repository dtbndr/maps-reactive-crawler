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
Preserve raw-nonempty expansion before deduplication, unique cell admission, existing deterministic geometry and independent limits. Apply a discovery result, its application marker, observations, cell outcome, neighbor admissions and associated work/gap updates atomically, or persist a demonstrably replayable intermediate state. Stable local observation/work keys prevent replay duplication and are distinct from canonical place identity. Do not treat the current cell-oriented in-memory attempt shape as a complete persistence contract.

## Assumptions and design decisions
- One integrated workstream with sequential gates: recovery and minimum verified identity interact at atomic result and gap boundaries; rejecting a schema-only first workstream avoids a misleading milestone. If the restartable discovery gate proves too large, stop and seek operator approval to rescope; the smaller workstream must retain stable keys, raw observations, provenance and pending work/gaps and must not claim full identity or milestone completion.
- Use local SQLite, temporary on-disk databases and a fresh process for restart tests, not just serialization and same-process simulation. Node is pinned to 26; use its built-in SQLite support rather than add a package. One operator and serial scheduler; no multi-writer distributed guarantees. Schema layout, helpers and SQL representation are implementation discretion subject to invariants.
- Fixture-supplied identity must be explicitly verified to merge observations; names, coordinates and raw IDs alone do not establish identity. Unverified observations remain separate. Preserve source cells, original observations and inside/outside/unverified classifications. Verified same-identity detail success may reconcile detail gaps; different or uncertain identity cannot, and discovery gaps never disappear merely because another cell finds the place. Real identity mapping remains a provider-integration blocker.
- Persist reservation and increment submissions before a potentially billable send. On restart an intent without a durable ID is uncertain, including a possibly unsent intent; never blindly retry. Persist recovered ID and synthetic evidence/source/time linked to original intent before observation; keep the gap until verified completion. Skip is durable and visible. Approved resend records approval/rationale and finite resend ordinal, consumes a fresh submission slot, and leaves prior billing uncertainty and gap visible until verified result. Authorization is not provider safety.
- Persist operation-scoped retry ordinals and finite ceilings before retry; initial ordinal zero, no reset on restart or cap change. Known-safe synthetic observation retries consume retry allowance but no submission slot. New submissions, including detail and resends, each reserve a slot; only fixture-defined known-safe transients can be automatically retried. Unknown acceptance is never safe solely because allowance remains. Backoff is bounded.
- Active time is cumulative and monotonic while active, including waits/backoff, excluding intentional pause and downtime. Persist deltas and pause transitions. If the interval after the last checkpoint cannot be bounded on restart, block admissions and sends until operator supplies defensible conservative accounting. A limit stops new submissions/admissions but not observation of already submitted work; cancellation may stop observation and never asserts remote cancellation. Cell cap does not strand admitted work. Cap increases preserve all totals.
- Isolated failures create cell or detail gaps and permit independent work when accounting remains trustworthy; global failure or corrupted checkpoint pauses all new work. Queue exhaustion with gaps is partial, never complete. Preserve stop reason, limits, counters, statuses and gap inventory; no claim of monetary bound.

### Implementation discretion
Internal helpers, schema names, fixture data, exact error text and annotations; no discretion to weaken the contracts above.

### Unresolved design blockers
None for synthetic offline behavior. Provider lookup, verification, retry, cancellation and billing contracts remain integration blockers and are not resolved here.

## Final verification
- [ ] `mise install`
- [ ] `mise exec -- npm ci`
- [ ] `mise exec -- npm run check` (project tests, type/lint/format checks as configured); all required checks pass.

## Slices

For every slice: establish meaningful RED for intentional changes before implementation; for refactors capture before/after evidence and add characterization where needed. Run focused tests and record exact results; run `mise exec -- npm run check` before handoff, distinguish verified baseline failures, and commit only after slice verification. Final verification has no baseline waiver.

### Slice A: Durable discovery checkpoint
**Goal**: Restartable discovery with stable replay identities and provenance.

#### Tasks
- [ ] Add local durable state initialization, versioned schema and atomic/replayable transition persistence for traversal, queue, observations, intent, ID and counters.
- [ ] On temporary on-disk databases, terminate and reopen in a fresh process at reservation, send-before-ID, ID-persisted and result-application boundaries. Assert DB state, fixture send counts, no automatic resend, known-ID observation, exactly-once local application and neighbor admission.
- [ ] Preserve partial outcomes, raw-nonempty behavior, candidate classification and independent caps. Confirm no lost provenance; use synthetic data only.

#### Watch out
Durable intent may over-count unsent work. Ensure application marker and dependent state cannot diverge. No full canonicalization required at this gate.

#### Verification
Focused restart and traversal tests plus full project check. Record the restartable discovery gate and assess whether rescoping requires operator approval.

#### Carry-forward
Durable discovery observations, replay keys, attempts, queue and accounting.

### Slice B: Recovery controls and accounting
**Goal**: Persist bounded recovery decisions and honest stops.

#### Tasks
- [ ] Implement durable known-ID recovery evidence, retry and resend ordinals/ceilings, approvals, skip, cancellation and isolated/global failure handling according to the handoff.
- [ ] Implement cumulative active-time checkpointing and fail-closed unbounded crash interval; preserve totals through pause, restart and limit changes.
- [ ] Test synthetic restart at each control boundary, observation without new submission, fresh reservation for approved resend, independent caps, cancellation, and known-ID observation after time cap.

#### Watch out
Never claim remote cancellation or billing certainty; skip and approval do not erase a gap. Corrupt/untrusted checkpoints block new work.

#### Verification
Focused recovery/accounting tests and full project check; assert durable state and fixture send counts.

#### Carry-forward
Operation-scoped durable recovery control usable for detail work.

### Slice C: Verified identity and detail recovery
**Goal**: Durable fixture-verified canonical identity and scoped gap reconciliation.

#### Tasks
- [ ] Add explicit verified synthetic keys and distinct unverified observations; preserve original source provenance and classifications, duplicate-only expansion and separate cell/detail gaps.
- [ ] Implement separately reserved and checkpointed detail work with durable fan-out and same-identity verified detail reconciliation only.
- [ ] Test fresh-process interruption after discovery with A complete, B uncertain and C pending; same/different/unverified identity, repeated observations, unresolved skip and queue exhaustion with gaps.

#### Watch out
Identity is not inferred from fixture names, coordinates or raw IDs. Never erase a discovery gap by finding a duplicate place.

#### Verification
Focused identity/fan-out and fresh-process tests plus full project check and final verification.

#### Carry-forward
Credential-free durable core and evidence for Workstream 3; provider mapping remains unverified.
