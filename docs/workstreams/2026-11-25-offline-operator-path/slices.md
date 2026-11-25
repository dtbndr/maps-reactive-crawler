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
- Status/export open existing SQLite read-only and use one consistent snapshot without the writer lease, initialization, recovery marking, clearing, or application writes. SQLite may require recovery or sidecar access; if a read-only consistent snapshot cannot be established, fail explicitly rather than recover or change the checkpoint. Missing, corrupt, unsupported or busy/unavailable snapshots fail explicitly. Report active or potentially interrupted state truthfully; never infer clean completion from absence of a writer. Inspection returns busy while a cooperating writer or publisher holds the exclusive coordination lock; it does not promise a concurrent writer snapshot. All fields in a successful inspection must describe the same transaction snapshot.
- `start` and `resume` return promises: between completed durable operations, yield to the event loop (not merely a microtask) and check the signal before another operation or submission. This adapter configures no automatic submission or observation retry policy. Before each core invocation, under the writer lease, refuse with an explicit actionable error any inherited retry path that could send more than once within that invocation without an event-loop cancellation boundary; do not consume, clear or rewrite its persisted authorization. Known-ID observation, including a persisted observation delay/authorization, remains eligible under the existing recovery and limit rules: invoke it without an automatic retry policy, preserving its normal core semantics. Do not globally reject all retry-bearing checkpoints or change existing recovery APIs. After an abort, wait for any synchronous callback and its active interval to settle and close, then durably cancel while retaining the writer lease; failed settlement remains an error requiring recovery, not successful cancellation. Check an already-aborted signal before work too. Standalone `cancel` obtains the writer lease only on an idle checkpoint, otherwise returns busy; it is not remote cancellation. Synchronous callbacks cannot be interrupted.
- Versioned output retains every raw occurrence and provenance, including per-observation inside/outside/unverified classification, verified identity groups and separate unverified records. Inclusive geographic eligibility applies to cell centers, not output filtering. Surface discovery and detail gaps separately, pending details, blocked/queued/running frontier, counters and all simultaneous limits alongside a headline. Exhaustion means discovery frontier exhaustion only, not coverage or detail completion. Fixture identity proves only fixture-declared identity, not provider behavior.

### Concrete surface contract
- CLI invocation is `mise exec -- node dist/cli.js <command> ...`. `start --checkpoint PATH --fixture PATH --lat N --lon N --spacing-m N (--radius-m N | --bbox SOUTH,NORTH,WEST,EAST) --cells N --submissions N --active-ms N`; `resume --checkpoint PATH --fixture PATH [--cells N] [--submissions N] [--active-ms N]`; `status --checkpoint PATH`; `export --checkpoint PATH`; `cancel --checkpoint PATH`. Exactly one area is required, all numbers parsed strictly and validated, duplicate/unknown options rejected. Resume only increases explicitly supplied caps, validates fixture first, and retains unspecified caps. It does not accept geometry changes. Commands return exit 0 for a successfully reported normal/partial durable outcome, nonzero for invalid input, busy, corrupt, identity mismatch or unexpected failure. On success stdout is exactly one JSON document; on failure stdout is empty and stderr contains the diagnostic (preflight may already have been emitted). No credentials.
- Exported library functions `start(options)`, `resume(options)`, `status({checkpoint})`, `exportResults({checkpoint})`, `cancel({checkpoint})` share CLI behavior. Start options contain checkpoint, fixture, geometry, limits, `onPreflight` and optional `signal`; resume contains checkpoint, fixture, optional increased limits and signal. `onPreflight` receives validated geometry and limits synchronously before collection. Status/export/cancel do not require a fixture. The CLI maps the documented flags to these objects; internal type names and test fixture values are discretionary.
- Slice B3 first owns the projection and exact JSON schema below, shared by all commands; C adds inspection and export. Successful `start`, `resume`, and `cancel` each return exactly `{version:1, command:"start"|"resume"|"cancel", status:<status v1>}` with the actual command literal and post-operation snapshot. Status returns the status object itself; export returns `{version:1,status:<status v1>,verifiedPlaces:[...],unverifiedObservations:[...]}`. Preflight stderr is exactly one JSON line `{version:1, type:"preflight", geometry:<geometry>, limits:<limits>}` before execution. B3 tests the complete documents, not only enums.
- Status v1 is `{version:1,state,headline,conditions,geometry,limits,counters,frontier,discoveryGaps,detailGaps,pendingDetails,coverage}`. Geometry is `{seed:{latitude,longitude},spacing,area}` with area `{type:"radius",radius}` or `{type:"bbox",south,north,west,east}`; limits are `{cells,submissions,activeTime}`; counters are `{admitted,submissions,activeTime}`. Frontier is `{queued:[cellKey],running:[cellKey],parked:[cellKey],blocked:[cellKey],discoveryExhausted:boolean}`; exhaustion means all four lists empty and no unresolved discovery attempt, not absence of gaps or pending detail. Discovery gaps are `{id:string|null,cellKey,cause,scope:"isolated"|"global"|null,status:"unresolved"|"resolved"|"skipped"|null}`; null preserves legacy absence and is treated as unresolved. Detail gaps are `{workId,identity,observationIds,status}`; pending details are `{id,identity,observationIds,status}` for every non-completed/non-skipped detail work item. Coverage is exactly `{cellCenterEligibility:true,returnedPlacesFiltered:false,exhaustive:false,detailComplete:false}`; these are limitations, not assertions that work is complete.
- An export occurrence is `{id,coordinate:{latitude,longitude}|null,classification,sourceCell,workId,attemptId,observationId,occurrence}`; absent coordinate becomes null and workId comes from the referenced attempt. Verified groups are `{canonicalKey,observations:[occurrence]}` and unverified observations are occurrences, never grouped. Preserve every raw occurrence and classification. All fields appear even when empty; sort occurrences by observationId, groups by canonicalKey, frontier by cellKey, detail work by id and observationIds lexically. Sort discovery gaps by cellKey, id, cause, scope, status; sort detail gaps by workId, identity, status, then their lexically sorted observationIds as a lexicographic sequence. Compare strings lexically and sort null before strings; identical records are interchangeable. Do not filter places.
- State precedence is `active`, `potentially_interrupted`, `cancelled`, `paused`, `idle`: active requires an owner positively known alive; an owner whose liveness cannot be established is potentially interrupted, not idle. Unknown owner liveness always selects potentially interrupted, even with valid cleanPauseEvidence and no interval or recovery flag. Otherwise a stale owner without valid cleanPauseEvidence, or any non-live owner with activeInterval or recoveryPending, is potentially interrupted. A stale owner with valid cleanPauseEvidence and no interval/recovery is paused; no owner plus activeInterval/recoveryPending is potentially interrupted. Remaining cancelled/paused flags select those states, otherwise idle. An active owner takes precedence even if other flags are set; liveness is a snapshot-time observation, not a guarantee.
- Conditions are sorted unique: `cells` iff blocked is nonempty; `submissions` iff submissions >= its cap; `active_time` iff activeTime >= its cap; `recovery_pending` iff recoveryPending, activeInterval without a live owner, or stale/unknown owner without clean pause evidence; `global_gap` iff an unresolved global discovery gap, unresolved detail gap, or reserved/dispatched/uncertain detail without a known ID blocks discovery under the core; `cancelled` and `paused` mirror flags. Headline precedence is `recovery_pending`, `global_gap`, `cancelled`, `paused`, `submissions`, `active_time`, `cells`, `discovery_exhausted`, `ready`, selecting the first applicable predicate. Caps describe reached thresholds, not a claim that known-ID observation is forbidden. `ready` never means a recovery/global blocker is runnable. Test a table including live owner with interval, stale owner with/without clean pause, unknown liveness, orphan interval, simultaneous caps, unresolved global gap with otherwise ready work, and clean idle exhaustion.

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

### Slice A1: Strict fixture and configuration validation
**Goal**: Establish validated synthetic input without enabling operator execution.

- [ ] Add fixture parser/identity and geometry and finite limit validation. Test malformed fixture, missing references, duplicate keys, unsupported version and invalid geometry/limits; assert no checkpoint mutation or sends. Same bytes at another path yield the same identity; changed bytes differ.
- [ ] Demonstrate focused RED for each contract, then build and run `mise exec -- node --test test/operator-fixture.test.mjs` and the full check as above.

**Carry-forward:** Validated configuration and exact-byte fixture identity only; no operator execution.

### Slice A2: Coordination and atomic publication
**Goal**: Establish independently tested acquisition and complete bound checkpoint publication without enabling operator execution.

- [ ] Implement atomic initialization/binding using A1's validated inputs. Test interruption before and after publication, orphan sidecars, contention and no partial bound destination or sends.
- [ ] Redesign acquisition under an explicit trust boundary: checkpoint directory and database/sidecars are operator-controlled; all publishers, writers and snapshot readers cooperate in one cross-process coordination protocol, and no malicious or out-of-protocol replacement, rename or sidecar tampering occurs. Use one nonblocking exclusive OS-released cross-process lock on a stable coordination object, held from before pathname/sidecar inspection and opening until the writer connection closes; publishers and readers take that same exclusive lock, so cooperating replacement cannot redirect a connection. Contention returns busy for every combination, including status/export during an active writer or publisher; no shared lock or concurrent snapshot success is promised. Support only local filesystems and platforms where the selected lock primitive provides cross-process exclusive locking, automatic release on process exit, and atomic no-replace publication; document the supported platform/filesystem combinations and detect and fail closed on unsupported or unverifiable configurations. Other acquisition errors fail explicitly; never proceed unlocked. A snapshot reader holds the coordination lock through open and its single read transaction, or fails; it takes no writer ownership. Never reopen the writer database by pathname after validation.
- [ ] Deterministically attempt cooperating replacement while acquisition holds the lock: it must block/fail until close. Test snapshot coordination and unavailable snapshots. Atomic publication is process-interruption atomicity, not a power-loss durability guarantee.
- [ ] Demonstrate focused RED for each contract, then build and run `mise exec -- node --test test/operator-acquisition.test.mjs` and the full check as above.

**Carry-forward:** A1 validation, exclusive acquisition and atomic publication; no operator execution until A3 completes binding validation.

### Slice A3: Same-connection binding validation after recovery
**Goal**: Fail closed on untrusted existing checkpoints before any application mutation or execution.

- [ ] With A2's lock held open one SQLite connection, begin an exclusion transaction, read and validate schema and exact fixture binding on that connection, then and only then perform application DDL, ownership/recovery marking, cap changes or sends; keep the connection and coordination lock throughout the lease. No precheck substitutes for this validation. SQLite open/locking may itself recover a hot journal or touch WAL/SHM before binding can be read: mismatch guarantees unchanged *logical committed application state* (including owner, interval and recovery blockers), no application mutation, cap change or send, not byte-identical files or unchanged SQLite recovery sidecars. Recovery may make previously committed state visible; compare against the logical state after SQLite's legitimate crash recovery, not raw pre-open bytes. Never clear blockers as a side effect of mismatch. If SQLite cannot recover/validate safely, fail explicitly. This does not protect against noncooperating filesystem actors or promise power-loss durability beyond SQLite/filesystem guarantees.
- [ ] Test changed bytes, legacy unbound checkpoints and same bytes at another path. Test mismatch on genuinely crashed hot-journal and WAL fixtures with stale owner and active interval against a separately recovered logical baseline; verify recovery markers and limits unchanged and zero sends, allowing SQLite file/sidecar changes. Attempt cooperating replacement after validation: it must block/fail until lease close, and concurrent opens must not mutate a different database.
- [ ] Demonstrate focused RED for each contract, then build and run `mise exec -- node --test test/operator-binding.test.mjs` and the full check as above.

**Watch out:** Do not use `DurableState.open` as read-only inspection. Validate before cap changes, and never infer known IDs from fixture ordering.

**Carry-forward:** A1 and A2 contracts plus same-connection validated identity-bound checkpoints and stable fixture lookup. Operator execution may be enabled only after all three slices pass; do not yet claim connected acceptance.

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
- [ ] Add event-loop yielding and signal handling to the async executor as specified above. Test a timer abort scheduled by the first send callback on a retry-capable checkpoint: no second submission occurs, callback completes, interval closes and cancellation is durable. Separately test inherited authorized retry paths: unsafe multi-send invocations are refused before consuming authorization, and no callback fires; compare persisted retry fields before/after. Test known-ID observation and persisted observation retry delay/authorization without automatic retry, including at submission/time caps, and assert existing recovery APIs and authorizations remain intact. Also test pre-abort, settlement failure and standalone idle/busy contention.
- [ ] Build and run `mise exec -- node --test test/operator-cancel.test.mjs`, then full check as above; record RED and GREEN.

### Slice B3: CLI execution adapter
**Goal**: Add strict process-facing start, resume and cancel only.
- [ ] Implement those three commands and the success/failure stdout, stderr and exit contracts above, including strict parsing and preflight; status/export arrive in Slice C. Process tests assert exact v1 enum values and malformed/busy/exception behavior. Use the shared library, not a parallel scheduler.
- [ ] Deliver a test-only child-process harness with injected fixture send/fault callbacks and one append-only ordering witness recording preflight and sends in order; use test-only entry points/modules excluded from production build and package, with no CLI flags, environment toggles, or new runtime-accessible production fault/backdoor hooks. The existing exported `setDurableDiscoveryBoundaryHookForTest` and other legacy test hooks remain as-is; this prohibition applies to new hooks, not removal of existing exports. Verify production output adds no new fault seam and the harness is excluded. Fresh child tests prove witness ordering and independent send counts. Exercise fault seams only through this harness, never public CLI.
- [ ] Build and run `mise exec -- node --test test/operator-cli.test.mjs`, then full check as above; record RED and GREEN.

### Slice C: Consistent inspection and provenance export
**Goal**: Add existing-only read-only status and versioned lossless export.

#### Tasks
- [ ] Implement snapshot reader and documented status/export in library and CLI (adding `status` and `export` to B3's three commands); assert the exact v1 state, headline and condition enums above in process tests. Test missing path creates nothing, read-only inspection does not acquire writer ownership or mutate database/recovery, and successful idle inspection uses one consistent snapshot. Deterministically hold a cooperating writer or publisher open and assert status/export return busy with no document; after release inspection succeeds. Test corruption, unsupported platforms/filesystems and versions, and truthful interrupted state using controlled persisted-owner/liveness fixtures.
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
- [ ] In separate unmodified public CLI processes start a nonempty seed with submission cap 1, inspect its durable checkpoint and public output for one seed attempt, queued admitted neighbors and pending but undispatched details; explicitly increase submission cap and resume a neighbor. Inspect and export to verify persisted attempt IDs/counts, seed not re-reserved, neighbor result, unchanged provenance, duplicate verified identity grouped with all occurrences and separate unverified observations. Use a fixture whose neighbor result differs from the seed so incorrect lookup is visible. These checkpoints do not independently prove callback invocation counts or ordering.
- [ ] Separately repeat that scenario in fresh B3 harness processes, reusing the production operator orchestration, acquisition, fixture parsing/lookup and durable executor, substituting only instrumented send/fault callbacks at the shared internal boundary. Its append-only witness proves preflight before sends, exact invocation counts, no seed replay and no detail sends; do not attribute this witness to public CLI processes.
- [ ] Using B3's test-only child harness for injected faults and actual CLI processes for public commands, exercise isolated failure, unrecognized response, global uncertainty, unresolved recovery accounting and cancellation separately from empty success. Assert public `discoveryGaps` causes `failed` with scope `isolated` and `unrecognized` respectively; for empty success assert no discovery gap and, with no remaining frontier or higher-precedence condition, `headline: "discovery_exhausted"`. Isolated failure and unrecognized may share that headline when the same predicates hold. Assert global uncertainty through an unresolved global discovery gap and `global_gap` condition/headline, recovery through `recovery_pending` condition/headline, and cancellation through `cancelled` condition/headline when no higher-precedence predicate applies; also assert simultaneous conditions where applicable. Check blocked frontier remains visible after a cap change and no coverage/exhaustive claim occurs.
- [ ] Document the offline command path and coverage limitations in `README.md`; no provider behavior claim or extra scope.

#### Watch out
A connected submission-cap continuation is not evidence that blocked frontier can be promoted. Pending details do not prevent discovery exhaustion but remain visible.

#### Verification
`mise exec -- npm run build` then `mise exec -- node --test test/operator-acceptance.test.mjs`; full check and final verification above.

#### Carry-forward
Milestone 2 offline acceptance evidence only; provider and location integrations remain separate approval-gated work.
