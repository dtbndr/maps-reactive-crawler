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
- Checkpoints reside in an operator-controlled trusted directory. Defend against ordinary concurrent initializers, interruption and corruption; deliberate replacement of checkpoint paths by a hostile filesystem actor is outside this offline workstream's threat boundary. This does not permit resetting an untrusted or corrupt checkpoint.
- One integrated workstream with sequential gates: recovery and minimum verified identity interact at atomic result and gap boundaries; rejecting a schema-only first workstream avoids a misleading milestone. If the restartable discovery gate proves too large, stop and seek operator approval to rescope; the smaller workstream must retain stable keys, raw observations, provenance and pending work/gaps and must not claim full identity or milestone completion.
- Use local SQLite, temporary on-disk databases and a fresh process for restart tests, not just serialization and same-process simulation. Node is pinned to 26; use its built-in SQLite support rather than add a package. One operator and serial executor; enforce exclusive checkpoint ownership for the executor lifetime, refusing a second process before any send. Unsupported schema versions and corrupt or untrustworthy checkpoints fail closed before dispatch. Test lock contention, release after process death, unsupported version and corruption. The ownership mechanism is an implementation choice, not an assumed SQLite locking guarantee; prove exclusivity and release after abrupt process death. Schema layout, helpers and SQL representation are implementation discretion subject to invariants. For strict TypeScript, dev-only Node type definitions or narrowly scoped local declarations are permitted; do not add a SQLite runtime package.
- Each work item and each attempt has a stable durable ID; associate acknowledgments, observations and application with those IDs, never global array position. A serial executor parks an isolated uncertain item outside the active slot without resolving its gap; it may advance another already-admitted item only when isolation and accounting are established. Global uncertainty or unbounded accounting blocks all new work. Recovering the parked item must not repeat dispatch or application. Keep missing-ID uncertain intent distinct from interrupted observation of a durable known ID; the former cannot enter observation until recovered ID and evidence are durably persisted.
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

### Slice A0: Durable state foundation
**Goal**: Establish the durable storage foundation without claiming restartable discovery.

- [ ] Characterize the existing scheduler; establish versioned Node SQLite state, fail-closed validation, exclusive ownership and atomic state transitions. Test unsupported schema, corruption, lock contention and reacquisition after process death, and restart of the state API using temporary on-disk databases.
- [ ] Preserve a path for stable work and attempt IDs, raw observations, provenance, pending work and gaps; do not claim the discovery gate is complete.
- [ ] Build before focused tests and the full project check; record results and commit the foundation.

### Slice A: Durable discovery checkpoint
**Goal**: Complete the restartable discovery gate on the Slice A0 foundation with stable replay identities and provenance. All original Slice A acceptance criteria below remain required; the gate is complete only after both A0 and A pass.

#### Tasks
- [ ] Add local durable state initialization, versioned schema and atomic transition persistence for traversal, queue, observations, intent, ID and counters. Test exclusive lock contention, release after process death, unsupported versions and corrupt checkpoints failing closed before any send.
- [ ] Characterize existing scheduler behavior before refactoring; introduce stable work/attempt IDs and parking of isolated uncertainty. On temporary on-disk databases, terminate and reopen in a fresh process after dequeue before reservation, at reservation, after send before ID, after ID persistence, during partial application writes before commit, and after commit before advancing. Use an independent durable synthetic send ledger outside the crawler checkpoint. Assert exact observations (including repeated raw IDs), queue, gaps, counters and send counts; rollback partial writes and apply committed result exactly once. Preserve observations durably for later detail fan-out; no detail work is required in this slice.
- [ ] Test parking uncertain A, advancing admitted B with established isolation, then re-observing A's already-persisted ID without duplicate dispatch or application. Global uncertainty blocks B. Prepare the checkpoint/test harness for bounded conservative crash-time debit or clean pause when later accounting is enabled; never assume an abrupt crash has zero active time. Recovered IDs and unknown-time accounting are tested in later slices.
- [ ] Preserve partial outcomes, raw-nonempty behavior, candidate classification and independent caps. Confirm no lost provenance; use synthetic data only.

#### Watch out
Durable intent may over-count unsent work. Ensure application marker and dependent state cannot diverge. No full canonicalization required at this gate.

#### Verification
`mise exec -- node --test test/fixture-driver.test.mjs` and new `test/durable-discovery.test.mjs`, plus full project check. Record the restartable discovery gate and assess whether rescoping requires operator approval.

#### Carry-forward
Durable discovery observations, replay keys, attempts, queue and accounting.

### Slice A1: Checkpoint and accounting safety
**Goal**: Make recovery entry and every work-producing transition fail closed on untrustworthy state or unresolved accounting, without claiming recovery controls complete.

- [ ] Validate persisted counters against reservations, attempts and queue/cell consistency; corrupt or unsupported state must block all new work before send. Guard recovery scheduling mutations and resend reservations as well as executor entry. Test nonnegative understated submissions, malformed attempts and inconsistent queue/cell state; assert no reservation or send.
- [ ] After abrupt restart require a defensible bounded conservative debit before continuation, or a clean-pause marker where applicable; never assume zero crash time. Exercise debit followed by continuation with an independent durable send ledger. Full unbounded-time accounting remains Slice B.
- [ ] Repair the four existing restart fixtures blocked at recoveryPending: assert pending accounting, apply and verify a defensible nonzero synthetic debit before intended continuation, and retain independent no-debit fail-closed tests. Atomically persist the debit and evidence before continuation; recognize clean pause only if durably recorded before interruption. Run a fresh full check. Existing fixture failures are not RED evidence for checkpoint-integrity or mutation-guard defects; establish separate meaningful failing tests for each. Document the WIP baseline; do not treat WIP code as trusted.

**Verification:** Build before RED and GREEN and focused tests: `mise exec -- npm run build`, then `mise exec -- node --test test/durable-recovery-accounting.test.mjs test/durable-recovery-controls.test.mjs test/durable-discovery.test.mjs`; build immediately before `mise exec -- npm run check`. Record exact baseline, RED and GREEN results and independent send counts.

**Carry-forward:** Validated checkpoint and guarded transitions for A2/A3; cumulative active-time enforcement remains B.

### Slice A2: Durable retry and recovered-ID execution
**Goal**: Recover isolated work and enforce operation-scoped retry decisions across restart.

- [ ] Persist authoritative synthetic recovered-ID evidence/source/time linked to the original intent before observation. Recover parked A without dispatching it again or altering unrelated running B; B advances only with isolation and trustworthy accounting. Global uncertainty blocks B. Test fresh processes, exact state and independent send counts, including crash after evidence persistence.
- [ ] In the actual fresh-process A/B recovery trace use the established accounting path, verifying debit and evidence before continuation.
- [ ] Test distinct fresh-process boundaries: after durable known-safe authorization but before reservation, consume it exactly once under its stored ordinal and ceiling despite changed caller policy; after reservation but before durable provider ID, refuse automatic dispatch. Assert exact durable state and independent send counts in both.
- [ ] Persist retry ordinals and finite ceilings before retry, initial ordinal zero, no reset on restart or cap change. Enforce durable authorization, ordinal succession and stored ceiling continuity rather than caller policy; only fixture-defined known-safe transients retry automatically, with bounded backoff. Observation retry consumes allowance but no submission slot.
- [ ] Test real isolated known-safe submission attempts across fresh-process restart: S=3, ordinal 2/2, cap 5, durable discovery gap A, admitted B proceeds at S=4, exhaustion reports partial_gaps. Test known-ID observation retry at submission cap without submission increments and allowance survival across cap changes.

**Verification:** Build before RED and GREEN and focused tests: `mise exec -- npm run build`, then `mise exec -- node --test test/durable-recovery.test.mjs test/durable-retry-executor.test.mjs test/durable-retry-exhaustion.test.mjs test/durable-discovery.test.mjs`; build immediately before `mise exec -- npm run check`. Record exact baseline, RED and GREEN results and independent send counts.

**Carry-forward:** Durable operation-scoped retry and recovered-ID controls for A3 and detail work.

### Slice A3: Recovery decisions and acceptance
**Goal**: Complete the original A1 recovery controls and fresh-process acceptance; A1 is complete only when A1, A2 and A3 pass in order.

- [ ] Persist skip, cancellation, isolated/global failures and approved resend with rationale, independently bounded durable resend ordinal/ceiling and a fresh submission reservation. Preserve prior uncertainty, billing history and gaps until verified completion; never claim remote cancellation or billing certainty.
- [ ] Test last reserved slot dispatch at cap uninterrupted; separately crash after reservation before durable ID and prove restart neither dispatches nor blindly resends regardless of the independent ledger. Test fresh-process admitted dispatch at cell cap, approved resend and cancellation with exact durable state and send counts. Skip and approval do not erase gaps; corrupt/untrusted checkpoints block new work.
- [ ] Run the complete recovery suite and full project check with fresh-process evidence for the preceding gates. Record exact baseline failures and meaningful RED for each gate before implementation, then GREEN; no baseline waiver for final verification.

**Verification:** Build before RED and GREEN and focused tests: `mise exec -- npm run build`, then `mise exec -- node --test test/durable-recovery.test.mjs test/durable-recovery-controls.test.mjs test/durable-recovery-accounting.test.mjs test/durable-retry-executor.test.mjs test/durable-retry-exhaustion.test.mjs test/durable-discovery.test.mjs`; build immediately before `mise exec -- npm run check`. Record exact baseline, RED and GREEN results; assert durable state and independent fixture send counts. Historical ledger entries for unsplit A1 remain unchanged and do not signify completion of the new A1 gate.

**Carry-forward:** Operation-scoped durable recovery controls usable for detail work; Slice B supplies full cumulative active-time accounting and unbounded-interval fail-closed behavior.

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

- [ ] Test known-ID discovery completion after submission or active-time exhaustion: atomically persist pending detail fan-out unreserved and undispatched, record neighbors blocked rather than admitted when admission is prohibited, and retain pending work across restart and a later cap increase.

#### Watch out
Identity is not inferred from fixture names, coordinates or raw IDs. Never erase a discovery gap by finding a duplicate place.

#### Verification
`mise exec -- node --test test/durable-identity.test.mjs` plus full project check and final verification.

#### Carry-forward
Credential-free durable core and evidence for Workstream 3; provider mapping remains unverified.
