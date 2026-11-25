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
- A run uses a versioned synthetic JSON fixture, SHA-256 of its exact bytes as its identity, and stable IDs, never a process-local cursor. Identical content at a different path is allowed; changed bytes fail before limit edits or execution. New checkpoint creation and binding are one durable transaction, with preflight validation before any collection. Existing legacy checkpoints lacking the binding fail closed rather than being silently adopted. This assumes operator-controlled checkpoint directories and synthetic data; change of fixture format requires a version change.
- Fixture v1 is a JSON object `{version: 1, discoveries: {<workId>: {id, observationId}}, observations: {<observationId>: {result, elapsed}}}`. `workId` is the durable discovery work ID supplied by the existing send callback; `id` is the stable synthetic known ID and equals the observation lookup key `observationId`. `result` uses the existing `DiscoveryResult` shape and `elapsed` is a finite nonnegative millisecond number. All referenced IDs are nonempty strings, unique per work, all references resolve, unknown fields and duplicate JSON keys are rejected, and malformed data fails before mutation. Failure cases use existing result variants or explicit fixture test seams, never a cursor. A fixture missing a requested work ID fails explicitly and cannot be interpreted as empty success. Reopen the format only for a demonstrated synthetic acceptance gap.
- Initialize with one seed, positive finite spacing in metres, explicit radius in metres or bbox in degrees, and finite independent cumulative cell, submission and active-millisecond limits accepted by the existing core. Validate using core rules; show the exact validated configuration before the first send, not an invented provider cost estimate. A preflight callback in the library runs before collection; CLI emits its JSON preflight line to stderr before invoking execution. No secrets or real data.
- `reportTraversal`'s `cells` headline is not a scheduling gate: admitted work drains subject to submission/time and recovery restrictions. A limit update does not promote blocked neighbors; report them and do not promise continuation by editing that cap. At submission or time exhaustion, eligible known-ID observation remains possible without new submission; do not suppress it. Preserve cumulative counters and retry ordinals across resumes.
- Status/export open existing SQLite read-only and use one consistent snapshot without the writer lease, initialization, recovery marking, clearing, or any writes. Missing, corrupt, unsupported or busy/unavailable snapshots fail explicitly. Report active or potentially interrupted state truthfully; never infer clean completion from absence of a writer. A snapshot may be older than a concurrent writer, but all fields must describe the same transaction snapshot.
- Cancellation is durable and cooperative between operations; an in-process library abort signal is checked at boundaries and no next submission starts after cancellation. A standalone CLI cancel obtains the writer lease only on an idle checkpoint, otherwise returns busy; it is not a remote cancellation. Synchronous callbacks cannot be interrupted. Reopen this assumption only if asynchronous execution is separately approved.
- Versioned output retains every raw occurrence and provenance, including per-observation inside/outside/unverified classification, verified identity groups and separate unverified records. Inclusive geographic eligibility applies to cell centers, not output filtering. Surface discovery and detail gaps separately, pending details, blocked/queued/running frontier, counters and all simultaneous limits alongside a headline. Exhaustion means discovery frontier exhaustion only, not coverage or detail completion. Fixture identity proves only fixture-declared identity, not provider behavior.

### Concrete surface contract
- CLI invocation is `mise exec -- node dist/cli.js <command> ...`. `start --checkpoint PATH --fixture PATH --lat N --lon N --spacing-m N (--radius-m N | --bbox SOUTH,NORTH,WEST,EAST) --cells N --submissions N --active-ms N`; `resume --checkpoint PATH --fixture PATH [--cells N] [--submissions N] [--active-ms N]`; `status --checkpoint PATH`; `export --checkpoint PATH`; `cancel --checkpoint PATH`. Exactly one area is required, all numbers parsed strictly and validated, duplicate/unknown options rejected. Resume only increases explicitly supplied caps, validates fixture first, and retains unspecified caps. It does not accept geometry changes. Commands return exit 0 for a successfully reported normal/partial durable outcome, nonzero for invalid input, busy, corrupt, identity mismatch or unexpected failure. Emit errors to stderr; stdout is one JSON document per command, with no credentials.
- Exported library functions `start(options)`, `resume(options)`, `status({checkpoint})`, `exportResults({checkpoint})`, `cancel({checkpoint})` share CLI behavior. Start options contain checkpoint, fixture, geometry, limits, `onPreflight` and optional `signal`; resume contains checkpoint, fixture, optional increased limits and signal. `onPreflight` receives validated geometry and limits synchronously before collection. Status/export/cancel do not require a fixture. The CLI maps the documented flags to these objects; internal type names and test fixture values are discretionary.
- Status JSON v1 has `version`, `state` (including active/potentially interrupted/paused/cancelled as applicable), `headline`, `conditions` (all reached limits and recovery blockers), `geometry`, `limits`, `counters`, `frontier` (queued, running, blocked and discovery exhaustion), `discoveryGaps`, `detailGaps`, `pendingDetails`, and `coverage` limitations. Export JSON v1 contains `version`, the same status snapshot, `verifiedPlaces` grouped only by verified canonical identity and `unverifiedObservations` individually; both preserve all original raw observations, source cell, work/attempt/observation IDs and classification. Fields are present even when empty; no output filter. Define stable ordering by durable IDs for reproducibility, not fixture iteration order.

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

For each slice: before implementation build and run the focused test to demonstrate meaningful RED for each new behavior, recording exact output and why it fails; do not count a missing test file as RED. Build again before GREEN and focused tests because tests import `dist`. Immediately before the full check run `mise exec -- npm run build`, then `mise exec -- npm run check`. Record actual results, distinguish verified unchanged baseline failures, fix regressions, and commit only slice-scoped changes after verification. A baseline failure never waives final verification.

### Slice A: Fixture binding and preflight
**Goal**: Establish validated synthetic input and atomic checkpoint identity before any work.

#### Tasks
- [ ] Add fixture parser/identity, geometry and finite limit validation and atomic initialization/binding in `src/operator.ts` and `src/durable-state.ts`. Test malformed fixture, missing references, duplicate keys, unsupported version, changed bytes, legacy checkpoint and initialization interruption; assert no sends or partial bound run. Same bytes at another path must pass.
- [ ] Establish `start`/`resume` preflight and identity validation before any existing-checkpoint mutation; test unchanged durable state on mismatch and before preflight. Do not yet claim connected acceptance.

#### Watch out
Do not use `DurableState.open` as read-only inspection. Validate before cap changes, and never infer known IDs from fixture ordering.

#### Verification
`mise exec -- npm run build` then `mise exec -- node --test test/operator-fixture.test.mjs`; full check as above.

#### Carry-forward
Versioned identity-bound checkpoints and stable fixture lookup.

### Slice B: Serial operator execution and cancellation
**Goal**: Connect shared start/resume and CLI to durable discovery without weakening recovery.

#### Tasks
- [ ] Implement the documented CLI and shared execution API; check preflight ordering and strict inputs. Execute only discovery serially; persist pending detail but never reserve or dispatch it.
- [ ] Test cell-cap admitted draining, blocked frontier not promoted by cap edit, simultaneous caps, known-ID observation at submission/time cap, no blind resend, no implicit unpause/debit/approval, and identity check before resume mutation. Use durable evidence for partial outcomes; unexpected exceptions remain errors.
- [ ] Implement and test cooperative boundary cancellation and idle-only standalone cancel, including contention and no next submission after cancellation; do not promise interruption of synchronous callbacks.

#### Watch out
Core `cells` report is not an executor gate. Preserve durable monotonic accounting, retry decisions and observation allowances.

#### Verification
`mise exec -- npm run build` then `mise exec -- node --test test/operator-execution.test.mjs test/operator-cancel.test.mjs`; full check as above.

#### Carry-forward
Shared serial writer path and explicit truthful stop conditions.

### Slice C: Consistent inspection and provenance export
**Goal**: Add existing-only read-only status and versioned lossless export.

#### Tasks
- [ ] Implement snapshot reader and documented status/export in library and CLI. Test missing path creates nothing, read-only inspection does not acquire writer ownership or mutate database/recovery, consistent snapshots during concurrent writer, busy failure, corruption and unsupported versions, and truthful active/interrupted state.
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
- [ ] In separate CLI processes start a nonempty seed with submission cap 1, assert preflight precedes send and eligible neighbors remain admitted/queued, then explicitly increase submission cap and resume a neighbor. Use an independent synthetic send ledger to assert exact counts, no seed replay and no detail sends. Inspect and export; assert unchanged provenance, duplicate verified identity grouped with all occurrences and separate unverified observations.
- [ ] Exercise isolated failure, unrecognized response, global uncertainty, unresolved recovery accounting and cancellation separately from empty success; verify distinct durable gaps, stop reasons and simultaneous conditions. Check blocked frontier remains visible after a cap change and no coverage/exhaustive claim occurs.
- [ ] Document the offline command path and coverage limitations in `README.md`; no provider behavior claim or extra scope.

#### Watch out
A connected submission-cap continuation is not evidence that blocked frontier can be promoted. Pending details do not prevent discovery exhaustion but remain visible.

#### Verification
`mise exec -- npm run build` then `mise exec -- node --test test/operator-acceptance.test.mjs`; full check and final verification above.

#### Carry-forward
Milestone 2 offline acceptance evidence only; provider and location integrations remain separate approval-gated work.
