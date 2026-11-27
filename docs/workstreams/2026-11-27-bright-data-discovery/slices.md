# Bright Data Discovery Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Propose a small, connected direct-HTTP discovery path over the existing bounded traversal and SQLite checkpoint, tested offline. This is a draft replacing a previously approved contract only if the operator approves the revised brief. No implementation is authorized by this draft.

## Scope
**Supported scenario:** one local operator, one process and checkpoint owner, one confirmed coordinate and keyword/country, explicit spacing and radius or bounding box, finite cell/submission/active-time caps; one cell request at a time. Status and export are local. Synthetic automated tests only. Live use requires separately applicable provider, pricing and rights evidence and explicit approval before potentially paid calls.

**Out:** geocoding, details, enrichment, verified identity, distributed/concurrent execution, provider cancellation, exhaustive coverage, real data in shared artifacts, publication, account changes, and calls to the provider during this work. Fixture mode remains supported. Operator-provided key stays out of checkpoints, diagnostics and shared output.

## Key files
- `src/bright-data-discovery.ts`: existing disabled adapter, proposed direct HTTP and conservative normalization.
- `src/durable-discovery.ts`, `src/durable-state.ts`, `src/traversal.ts`: existing SQLite lifecycle and traversal.
- `src/operator.ts`, `src/cli.ts`: fixture CLI and proposed operator path.
- `test/bright-data-discovery.test.mjs`, `test/durable-discovery.test.mjs`, `test/durable-recovery.test.mjs`, `test/operator-acceptance.test.mjs`, `test/operator-cli.test.mjs`: offline checks.
- `docs/research/bright-data-mcp.md`, `docs/research/legacy-reactive-crawl.md`, `README.md`: evidence and operator notice.

## Architecture invariant
Never send without the separate operator authorization required for paid work or without applicable current provider, account pricing and rights evidence. Approval of this brief authorizes implementation only. Direct API use is disclosed; MCP is optional. Reserve and persist dispatch before a send, persist any returned ID before observation, and never blindly resend an uncertain send. Do not hold SQLite transactions over network waits. Never treat a failure as empty. Retain existing fixture behavior and checkpoint ownership, and never log credentials or raw provider responses.

## Assumptions and design decisions
- Evidence: the operator reports one separately approved `/datasets/v3/scrape` GB pizza probe, limit 10: 202 with ID, five running polls within two minutes, eventually ready, array of ten records with `name` and `place_id`, `business_details` list, `phone_number`, latitude and longitude, no errors. This is one observation, not a guarantee of schema, lifecycle, identity, completeness, cost or rights. Legacy `maps.js` submits, polls and downloads; `mapResults.js` requires name and place_id and extracts phone/site from business_details. Legacy behavior is not a current provider contract. Research notes describe older documentary evidence and open questions; record new applicable evidence with dates and scope before implementing an operation. No raw sample or secrets enter the repository.
- Use the documented direct HTTP `/datasets/v3/scrape` flow, its documented acknowledgment, progress and snapshot retrieval, not an SDK, separate details request or generic abstraction. The probe does not prove inline success or other outcomes; support only currently documented and understood response variants and fail visibly on unknowns. Verify endpoint parameters, request fields, response and status meanings, and polling guidance against current applicable primary documentation before implementing each behavior. No provider calls are authorized to resolve gaps. If material evidence is missing, leave the affected route disabled and report what is missing; do not invent parameters.
- Normalize synthetic records conservatively: require nonempty string name and place_id for a candidate, use optional phone/site from recognizable business_details and optional documented top-level phone/coordinates only when valid; ignore absent optional fields. Invalid entries or provider error markers are visible gaps, not successful empty. Do not infer completeness from a ten-record sample or a ready array. Preserve candidate provenance; place_id is an unverified candidate key, never a verified identity. Use raw nonempty accepted response to drive existing cardinal expansion only when the response is understood and has no indicated error or truncation; indicated partial/capped results retain candidates and a gap without expansion. Any provider result limit can hide results; communicate that coverage is heuristic even for an otherwise valid response. Do not assert stable identity or strict returned-place bounds.
- Simple bounded waits: sequential requests with finite per-request timeout, poll count and total observation deadline; respect applicable documented retry-after and stop on unknown/error/429 rather than retrying blindly. Keep the ID and a visible gap if time, count, interruption or error ends observation. The active-time cap stops new submissions; this draft proposes that it also stops observation at the local cutoff, rather than a separate durable observation allowance. No remote cancellation is implied.
- Minimal recovery: after a clean stop with a durable known ID, resume observation only if the existing checkpoint's supported recovery and remaining limits permit it; never claim all paused observations resume. For a crashed interval, use existing recovery/accounting procedures only when available and evidenced; otherwise stop. Workaround: preserve the local checkpoint and displayed ID, inspect status locally; with separate approval and applicable terms, the operator may check that ID through the provider's own interface. Keep the gap and do not issue a replacement submission or manually import results as though recovered; if no ID is known, consult provider support/account history where available, retain the gap, and do not retry that cell. A new crawl is a separate potentially billable operation and requires explicit approval; it does not repair the old checkpoint. No automatic reconciliation or remote cancel is promised.
- Bind persisted provider run to its non-secret query, geometry and provider mode; reject mismatched resume before transport or checkpoint mutation. Preserve exclusive ownership and offline fixture compatibility. Single-process operation is the supported scenario, not a promise to defend against a hostile local process.
- Authorization: before any potentially paid operation obtain explicit operator approval covering query, bounds, work/stop limits and known uncertainty of charges; show these in an operator preview. This draft proposes an explicit CLI confirmation per live invocation instead of the prior library-enforced TTY/anti-buffer/PTY machinery; no promise of authentication against hostile local actors. An approval is not provider evidence, a pricing quote, or a rights grant; applicable current technical contract, account/dataset pricing and permitted collection/storage/export rights remain separately checked before actual use. If pricing cannot establish a reliable estimate, state uncertainty and obtain explicit acceptance of that uncertainty; do not fabricate a cost cap. Production use remains blocked when applicable evidence is absent. No paid call, publication or external account change is authorized by this draft.

### Priority and prior-gate reassessment
In the supported local single-operator scenario, duplicate paid work from an uncertain send, leaked credentials, silent failure and unbounded work have direct P0/P1 impact; retain dispatch/ID durability, bounded work, redaction and honest stops. Full durable poll-budget scheduling across restarts, exact-ID-only resume, extensive PTY anti-buffer checks, separate post-cutoff observation budget, automatic reconciliation and signal-specific race matrices cost substantial work beyond the demonstrated scenario. The documented stop/preserve/inspect workaround limits harm; propose deferring these as P2 when applicable, not silently removing an approved gate. Existing required checks and the old approved acceptance remain binding until explicit operator approval of the revised brief; release-impact grade is not gate waiver. Reassess if evidence or scope grows. Terminal confirmation is a proposed simpler consent mechanism, not a substitute for authorization or terms. Do not expand this workstream to handle speculative concurrency or providers.

### Existing work and reconciliation
Slice A was reviewed clean under the old plan; its `createBrightDataDiscoveryAdapter` is a disabled seam, not a working HTTP route. Slice B has commit `f58142a` and uncommitted changes in `src/durable-discovery.ts`, `src/durable-state.ts`, `src/traversal.ts`, `test/durable-discovery.test.mjs` and `.solopowers/wsd/bright-data-discovery/implementer-B-report.md`. Preserve all existing work, including the report; do not reset, overwrite, stash, cherry-pick or discard it. Before implementation, inspect committed and uncommitted diffs, establish build and focused/full test baseline, and map each piece to the approved revised behavior; preserve compatible work, adapt only with owner agreement where it conflicts, and report anything unverified or unsuitable. No existing review or commit implies the combined B work is correct or usable. If safe reconciliation cannot be established without discarding or changing user work, stop for operator direction. New slice IDs below describe proposed milestones, not retroactive acceptance of old A/B.

### Implementation discretion
Internal helpers, names, test fixture values and decomposition are implementation choices, within the above contract.

### Unresolved design blockers
Revised brief approval and mandatory internal review are pending; external review remains opted in. Current applicable provider operation, pricing and rights evidence is not established by the probe. If evidence implies materially different behavior or recovery, stop and return to the operator; no live route may be enabled by assumption.

## Final verification
- [ ] `mise install`; `mise exec -- npm ci`.
- [ ] Build before every focused RED/GREEN run and full check: `mise exec -- npm run build` (tests import `dist/`).
- [ ] `mise exec -- npm run check`; every required final check must pass. No live calls. Record actual results and distinguish unchanged baseline failures; do not waive required gates.
- [ ] Internal review, opted-in external review, and operator approval precede implementation. A separately authorized bounded live demonstration is not implied by offline acceptance.

## Slices

### Slice D: Reconcile and implement the direct HTTP boundary
**Goal:** A credential-free tested adapter for the evidenced single-cell request, bounded observation and conservative record mapping, disabled where evidence is missing.

#### Tasks
- [ ] After approval, reconcile existing A/B work as above. Record current documentary evidence and probe limitations without raw data. Establish meaningful RED after building, then implement only evidence-backed request, 202/ID, progress, retrieval and recognized result/error variants; keep unresolved operations disabled. Use injected synthetic HTTP for tests; no network calls.
- [ ] Verify finite request/observation bounds, retry-after behavior where documented, unknown status and 429 stops, sanitized errors, optional/malformed fields and candidate-only identity. Do not introduce details or a framework.
- [ ] Run focused and full checks; commit only verified changes, preserving unrelated work.

#### Watch out
202 and ten records are one sample, not a contract. A real key must not itself enable calls.
#### Verification
`mise exec -- npm run build`; `mise exec -- node --test test/bright-data-discovery.test.mjs`; `mise exec -- npm run check`.
#### Carry-forward
Evidence-scoped async transport, normalized candidate observations and bounded failure outcomes.

### Slice E: Connect durable traversal and recovery
**Goal:** Connect the adapter to bounded SQLite traversal with honest stop and uncertainty semantics.

#### Tasks
- [ ] Characterize fixture behavior and verify relevant RED after build. Adapt compatible existing B work, retain synchronous fixture callers, dispatch-before-send and ID-before-poll, and avoid transactions across I/O. Record IDs and local gaps; never resend unknown sends. Enforce independent limits, single owner and bound query/mode; stop at active-time cutoff.
- [ ] Synthetic restart tests cover crash after dispatch before ID, known-ID clean pause and permitted resume, unknown or exhausted observation, failures versus empty, expansion on understood raw nonempty results and partial/capped gaps. Exercise the exact unsupported recovery workaround in status; do not assert automatic recovery for every case.
- [ ] Run focused and full checks and commit verified changes only.

#### Watch out
Existing B changes are unreviewed in combination; do not assume their accounting or restart behavior passes. No cancellation of remote work.
#### Verification
`mise exec -- npm run build`; `mise exec -- node --test test/durable-discovery.test.mjs test/durable-recovery.test.mjs`; `mise exec -- npm run check`.
#### Carry-forward
A bounded durable adapter path and explicit unsupported recovery states.

### Slice F: Operator path and documentation
**Goal:** Expose the supported scenario and its explicit consent, results and limitations without changing fixture operation.

#### Tasks
- [ ] Establish meaningful RED after build; wire CLI/operator start, status, supported resume and export to the durable path. Before potentially paid work display query, limits and uncertain cost and require explicit operator approval; block when applicable provider, pricing or rights evidence is absent. Validate binding before mutation or transport; preserve IDs and actionable gaps, redact secrets and raw provider errors. No production test seam may silently authorize a paid call.
- [ ] Synthetic CLI acceptance covers one seed, bounds and caps, nonempty expansion, empty, failure, capped/partial, uncertain send, known-ID stop, no automatic unsafe resend, candidate provenance, fixture compatibility and direct API notice. Document exact local recovery workaround and limitations in `README.md`; no live data in tests or examples.
- [ ] Run focused and full checks and commit verified changes only.

#### Watch out
Operator approval does not establish terms or price; a local stop does not cancel a remote job. Existing fixture status and export behavior must remain compatible.
#### Verification
`mise exec -- npm run build`; `mise exec -- node --test test/operator-acceptance.test.mjs test/operator-cli.test.mjs test/bright-data-discovery.test.mjs`; `mise exec -- npm run check`.
#### Carry-forward
Offline evidence of the connected path; any live demonstration remains separately approved and subject to applicable evidence.
