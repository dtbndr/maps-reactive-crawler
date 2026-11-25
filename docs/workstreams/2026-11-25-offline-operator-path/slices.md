# Offline Operator Path Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Connect the existing synthetic durable discovery core to a single operator-facing library and CLI, and prove the Milestone 2 connected offline exit.

## Scope
**In scope:** coordinate input, fixture-backed serial discovery, checkpoint binding, read-only status/export, cooperative cancellation, connected fresh-process acceptance and honest coverage reporting.

**Out of scope:** implementation of detail execution in this path, provider/geocoder or location input, paid calls, plugins, automatic recovery approvals, exhaustive coverage, publishing or account changes. Do not alter core frontier semantics to make the demo pass.

## Key files
- `src/index.ts`, `src/traversal.ts`: geometry, traversal and reporting contracts.
- `src/durable-state.ts`, `src/durable-discovery.ts`: transactional checkpoint, ownership, recovery and serial discovery.
- `src/operator.ts`, `src/cli.ts`: new shared operator surface and CLI adapter; export the library from `src/index.ts`.
- `test/operator-*.test.mjs`, `test/fixtures/`: new synthetic contracts and process acceptance; use temporary on-disk checkpoints.
- `docs/research/bounded-crawl-recovery.md`, `docs/milestones/02-offline-reactive-slice.md`: inherited accounting and milestone boundaries.

## Architecture invariant
One serial discovery executor per writer lease; never schedule detail. Existing discovery application still atomically creates pending detail work and preserves detail provenance and gaps. Treat checkpoint and fixture as untrusted input: validate before mutations or execution, fail closed on unsupported versions, corrupt data, identity mismatch or unavailable consistent snapshot. Preserve existing no-blind-resend, retry, recovery debit, known-ID and cumulative active-time rules. No implicit unpause, recovery decision or approval. Never classify arbitrary thrown exceptions as successful or empty observations.

## Assumptions and design decisions
- A thin shared library is the only behavior owner; CLI-only was rejected because programmatic operators would diverge. A general plugin framework was rejected as unrelated to the synthetic milestone. Reopen only if the approved operator path requires another integration boundary.
- A run uses a versioned synthetic JSON fixture, SHA-256 of its exact bytes as its identity, and stable IDs, never a process-local cursor. Identical content at a different path is allowed; changed bytes fail before limit edits or execution. Create the complete initialized and fixture-bound database in a private same-directory staging location, commit and close it, then atomically publish without replacement; an interruption leaves either no destination or a complete bound checkpoint. Reject orphan sidecars and clean staging safely. Preflight validation precedes collection. Existing legacy checkpoints lacking the binding fail closed rather than being silently adopted. This assumes operator-controlled checkpoint directories and synthetic data; change of fixture format requires a version change.
- Fixture v1 is a JSON object `{version: 1, discoveries: {<workId>: {id, observationId}}, observations: {<observationId>: {result, elapsed}}}`. `workId` is the durable discovery work ID supplied by the existing send callback; `id` is the stable synthetic known ID and equals the observation lookup key `observationId`. `result` uses the existing `DiscoveryResult` shape and `elapsed` is a finite nonnegative millisecond number. All referenced IDs are nonempty strings, unique per work, all references resolve, unknown fields and duplicate JSON keys are rejected, and malformed data fails before mutation. Failure cases use existing result variants or explicit fixture test seams, never a cursor. A fixture missing a requested work ID fails explicitly and cannot be interpreted as empty success. Reopen the format only for a demonstrated synthetic acceptance gap.
- Initialize with one seed, positive finite spacing in metres, explicit radius in metres or bbox in degrees, and finite independent cumulative cell, submission and active-millisecond limits accepted by the existing core. Validate using core rules; show the exact validated configuration before the first send, not an invented provider cost estimate. A preflight callback in the library runs before collection; CLI emits its JSON preflight line to stderr before invoking execution. No secrets or real data.
- `reportTraversal`'s `cells` headline is not a scheduling gate: admitted work drains subject to submission/time and recovery restrictions. A limit update does not promote blocked neighbors; report them and do not promise continuation by editing that cap. At submission or time exhaustion, eligible known-ID observation remains possible without new submission; do not suppress it. Preserve cumulative counters and retry ordinals across resumes.
- Status/export open existing SQLite read-only and use one consistent snapshot without the writer lease, initialization, recovery marking, clearing, or any writes. Missing, corrupt, unsupported or busy/unavailable snapshots fail explicitly. Report active or potentially interrupted state truthfully; never infer clean completion from absence of a writer. A snapshot may be older than a concurrent writer, but all fields must describe the same transaction snapshot.
- `start` and `resume` return promises: between completed durable operations, yield to the event loop (not merely a microtask) and check the signal before another operation or submission. After an abort, wait for any synchronous callback and its active interval to settle and close, then durably cancel while retaining the writer lease; failed settlement remains an error requiring recovery, not successful cancellation. Check an already-aborted signal before work too. Standalone `cancel` obtains the writer lease only on an idle checkpoint, otherwise returns busy; it is not remote cancellation. Synchronous callbacks cannot be interrupted.
- Versioned output retains every raw occurrence and provenance, including per-observation inside/outside/unverified classification, verified identity groups and separate unverified records. Inclusive geographic eligibility applies to cell centers, not output filtering. Surface discovery and detail gaps separately, pending details, blocked/queued/running frontier, counters and all simultaneous limits alongside a headline. Exhaustion means discovery frontier exhaustion only, not coverage or detail completion. Fixture identity proves only fixture-declared identity, not provider behavior.

### Concrete surface contract
- CLI invocation is `mise exec -- node dist/cli.js <command> ...`. `start --checkpoint PATH --fixture PATH --lat N --lon N --spacing-m N (--radius-m N | --bbox SOUTH,NORTH,WEST,EAST) --cells N --submissions N --active-ms N`; `resume --checkpoint PATH --fixture PATH [--cells N] [--submissions N] [--active-ms N]`; `status --checkpoint PATH`; `export --checkpoint PATH`; `cancel --checkpoint PATH`. Exactly one area is required, all numbers parsed strictly and validated, duplicate/unknown options rejected. Resume only increases explicitly supplied caps, validates fixture first, and retains unspecified caps. It does not accept geometry changes. Commands return exit 0 for a successfully reported normal/partial durable outcome, nonzero for invalid input, busy, corrupt, identity mismatch or unexpected failure. On success stdout is exactly one JSON document; on failure stdout is empty and stderr contains the diagnostic (preflight may already have been emitted). No credentials.
- Exported library functions `start(options)`, `resume(options)`, `status({checkpoint})`, `exportResults({checkpoint})`, `cancel({checkpoint})` share CLI behavior. Start options contain checkpoint, fixture, geometry, limits, `onPreflight` and optional `signal`; resume contains checkpoint, fixture, optional increased limits and signal. `onPreflight` receives validated geometry and limits synchronously before collection. Status/export/cancel do not require a fixture. The CLI maps the documented flags to these objects; internal type names and test fixture values are discretionary.
- Status JSON v1 has `version: 1`, `state` (one of `active`, `potentially_interrupted`, `cancelled`, `paused`, `idle`, in that precedence), `headline` (one of `recovery_pending`, `cancelled`, `paused`, `submissions`, `active_time`, `cells`, `discovery_exhausted`, `ready`, in that precedence), `conditions` (a sorted unique array drawn from `cells`, `submissions`, `active_time`, `recovery_pending`, `global_gap`, `cancelled`, `paused`; include every applicable condition regardless of headline), `geometry`, `limits`, `counters`, `frontier` (queued, running, blocked and discovery exhaustion), `discoveryGaps`, `detailGaps`, `pendingDetails`, and `coverage` limitations. Export JSON v1 contains `version`, the same status snapshot, `verifiedPlaces` grouped only by verified canonical identity and `unverifiedObservations` individually; both preserve all original raw observations, source cell, work/attempt/observation IDs and classification. Fields are present even when empty; no output filter. Define stable ordering by durable IDs for reproducibility, not fixture iteration order.

- Fixture `elapsed` is validated but never charged: durable active milliseconds use only monotonic clock deltas, including active synchronous work and settlement, not inactive time between invocations. Inject a monotonic clock in library tests; control successive samples to test exact cumulative charging, no double charge, invalid/backwards samples and interrupted settlement/recovery. Production uses the existing monotonic clock.
- Expected stop outcomes must be explicit typed results or typed core stop signals, not inferred by matching exception text or by finding a limit/gap after catching an arbitrary exception. Adapt the core boundary where necessary to identify time exhaustion and unresolved recovery before/after settlement; preserve known-ID observation eligibility. Callback, clock, transition and settlement exceptions propagate as failures even if a limit or gap also exists; a failed settlement leaves its recovery marker. A successfully returned durable failed/unrecognized result may be reported as partial, but a thrown callback failure is not success.

### Implementation discretion
Helper decomposition, internal storage layout, error wording, fixture values and local types, provided the above contracts hold.

### Unresolved design blockers
None. Live provider identity, lookup, billing and cancellation remain outside this workstream.

## Final verification
- [ ] `mise install`
- [ ] `mise exec -- npm ci`
- [ ] `mise exec -- npm run build`
- [ ] `mise exec -- npm run check` (typecheck, tests and build; no separate lint or formatter scripts exist). All required commands must pass; no baseline waiver at final verification.

---

## Slices

Before editing affected durable behavior, inspect existing tests and add and run passing characterization tests for any uncovered recovery, ownership, active-time and stop-boundary behavior; record baseline results separately from new-behavior RED. For each slice: before implementation build and run the focused test to demonstrate meaningful RED for each new behavior, recording exact output and why it fails; do not count a missing test file as RED. Build again before GREEN and focused tests because tests import `dist`. Immediately before the full check run `mise exec -- npm run build`, then `mise exec -- npm run check`. Record actual results, distinguish verified unchanged baseline failures, fix regressions, and commit only slice-scoped changes after verification. A baseline failure never waives final verification.

### Slice A: Fixture binding and preflight
**Goal**: Establish validated synthetic input and atomic checkpoint identity before any work.

#### Tasks
- [ ] Add fixture parser/identity, geometry and finite limit validation and atomic initialization/binding in `src/operator.ts` and `src/durable-state.ts`. Test malformed fixture, missing references, duplicate keys, unsupported version, changed bytes, legacy checkpoint and initialization interruption; assert no sends or partial bound run. Same bytes at another path must pass.
- [ ] Redesign writer acquisition: on the same opened database connection, begin an exclusion transaction and validate the binding before WAL mode changes, DDL, ownership, recovery marking, cap edits or other persistent mutation; acquire ownership and perform recovery only after validation under that transaction. Pin the opened database and its SQLite sidecars against pathname replacement for the entire lease using an OS-enforced, cross-process directory/path coordination mechanism honored by all checkpoint publishers and writers; never reopen by pathname after validation. Verify the pinned database identity at acquisition, fail closed if safe pinning cannot be established, and do not rely on pre/post stat checks alone (they leave a race). Define and test the supported operator-controlled filesystem assumptions; out-of-protocol external replacement must fail closed rather than redirect writes. A read-only precheck alone is insufficient. Test mismatch with an interrupted active interval and stale owner, byte/logical state unchanged including recovery and owner; race replacement and concurrent open tests must prove no wrong DB is mutated. Test publication interruption before and after atomic publish, destination contention and sidecars. Do not yet claim connected acceptance.

#### Watch out
Do not use `DurableState.open` as read-only inspection. Validate before cap changes, and never infer known IDs from fixture ordering.

#### Verification
`mise exec -- npm run build` then `mise exec -- node --test test/operator-fixture.test.mjs`; full check as above.

#### Carry-forward
Versioned identity-bound checkpoints and stable fixture lookup.

### Slice B1: Serial operator execution
**Goal**: Connect shared start/resume to durable discovery without weakening recovery.

#### Tasks
- [ ] Implement shared asynchronous start/resume execution and preflight. Execute only discovery serially; persist pending detail but never reserve or dispatch it. Test controlled monotonic accounting and explicit expected-stop versus exception classification at time and recovery boundaries, including simultaneous gap/limit and thrown callback or settlement failure.
- [ ] Test cell-cap admitted draining, blocked frontier not promoted by cap edit, simultaneous caps, known-ID observation at submission/time cap, no blind resend, no implicit unpause/debit/approval, and identity check before resume mutation. Use durable evidence for partial outcomes; unexpected exceptions remain errors.

#### Watch out
Core `cells` report is not an executor gate. Preserve durable monotonic accounting, retry decisions and observation allowances.

#### Verification
`mise exec -- npm run build` then `mise exec -- node --test test/operator-execution.test.mjs`; full check as above.

#### Carry-forward
Shared serial writer path and explicit truthful stop conditions.

### Slice B2: Cooperative cancellation
**Goal**: Make in-flight local abort and idle-only cancellation independently verifiable.
- [ ] Add event-loop yielding and signal handling to the async executor as specified above; deliver abort from a timer while a run is underway, verify callback completion, closed interval, durable cancellation and no next submission. Also test pre-abort, settlement failure and standalone idle/busy contention.
- [ ] Build and run `mise exec -- node --test test/operator-cancel.test.mjs`, then full check as above; record RED and GREEN.

### Slice B3: CLI execution adapter
**Goal**: Add strict process-facing start, resume and cancel only.
- [ ] Implement those three commands and the success/failure stdout, stderr and exit contracts above, including strict parsing and preflight; status/export arrive in Slice C. Process tests assert exact v1 enum values and malformed/busy/exception behavior. Use the shared library, not a parallel scheduler.
- [ ] Deliver a test-only child-process harness with injected fixture send/fault callbacks and one append-only ordering witness recording preflight and sends in order; use test-only entry points/modules excluded from production build and package, with no CLI flags, environment toggles, or runtime-accessible production fault/backdoor hooks. Fresh child tests prove witness ordering and independent send counts. Exercise fault seams only through this harness, never public CLI.
- [ ] Build and run `mise exec -- node --test test/operator-cli.test.mjs`, then full check as above; record RED and GREEN.

### Slice C: Consistent inspection and provenance export
**Goal**: Add existing-only read-only status and versioned lossless export.

#### Tasks
- [ ] Implement snapshot reader and documented status/export in library and CLI (adding `status` and `export` to B3's three commands); assert the exact v1 state, headline and condition enums above in process tests. Test missing path creates nothing, read-only inspection does not acquire writer ownership or mutate database/recovery, consistent snapshots during concurrent writer, busy failure, corruption and unsupported versions, and truthful active/interrupted state.
- [ ] Test all simultaneous conditions, blocked and pending frontier, distinct discovery/detail gaps and pending detail, all classifications and provenance, verified-only dedup and separate unverified records; output no exhaustive or detail-completion claim.

#### Watch out
One SQLite snapshot must cover every reported field. Do not filter returned places using cell-center geometry.

#### Verification
`mise exec -- npm run build` then `mise exec -- node --test test/operator-inspection.test.mjs`; full check as above.

#### Carry-forward
Inspectable durable outcomes for connected acceptance.

### Slice D: Connected fresh-process acceptance
**Goal**: Prove the credential-free milestone path and partial outcomes end to end.

#### Tasks
- [ ] In separate CLI processes start a nonempty seed with submission cap 1, assert preflight precedes send via the single shared ordering witness from B3, and eligible neighbors remain admitted/queued, then explicitly increase submission cap and resume a neighbor. Use an independent synthetic send ledger to assert exact counts, no seed replay and no detail sends. Inspect and export; assert unchanged provenance, duplicate verified identity grouped with all occurrences and separate unverified observations.
- [ ] Using B3's test-only child harness for injected faults and actual CLI processes for public commands, exercise isolated failure, unrecognized response, global uncertainty, unresolved recovery accounting and cancellation separately from empty success; verify distinct durable gaps, stop reasons and simultaneous conditions. Check blocked frontier remains visible after a cap change and no coverage/exhaustive claim occurs.
- [ ] Document the offline command path and coverage limitations in `README.md`; no provider behavior claim or extra scope.

#### Watch out
A connected submission-cap continuation is not evidence that blocked frontier can be promoted. Pending details do not prevent discovery exhaustion but remain visible.

#### Verification
`mise exec -- npm run build` then `mise exec -- node --test test/operator-acceptance.test.mjs`; full check and final verification above.

#### Carry-forward
Milestone 2 offline acceptance evidence only; provider and location integrations remain separate approval-gated work.
