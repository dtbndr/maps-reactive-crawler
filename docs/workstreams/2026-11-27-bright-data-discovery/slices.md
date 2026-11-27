# Bright Data Discovery Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Implement a small, connected direct-HTTP discovery path over the existing bounded traversal and SQLite checkpoint, tested offline. The revised brief is approved and replaces the earlier workstream contract; paid calls require separate authorization.

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
- Normalize synthetic records conservatively: require nonempty string name and place_id for a candidate; optional documented coordinates may be retained only when valid. Do not extract phone or website. Invalid entries or provider error markers are visible gaps, not successful empty. Preserve candidate provenance; place_id is an unverified candidate key, never a verified identity. An understood nonempty array shorter than the requested `limit_per_input`, with no indicated error or truncation, may drive cardinal expansion. An array at the requested limit with no truncation marker is potentially capped: retain candidates and a visible gap, do not expand. Indicated partial/capped results likewise do not expand; unknown or malformed outcomes are gaps. A dense seed can therefore stop the crawl; inspecting candidates and starting a separately approved bounded crawl at another seed is the workaround, not a completeness guarantee. Any provider limit can hide results; do not assert stable identity, exhaustive coverage or strict returned-place bounds.
- Simple bounded waits: sequential requests with finite per-request timeout, poll count and total observation deadline; respect applicable documented retry-after and stop on unknown/error/429 rather than retrying blindly. Before every wait or I/O, bound its duration by the smaller of its own timeout/deadline and remaining active time; at cutoff abort local waiting, initiate no more requests, ignore late results and do not expand. Persist an acknowledged ID before observing; if an ID arrives at cutoff, persist it when available and retain a gap, otherwise mark the send uncertain. A clean stop persists any available ID and gap, settles actual elapsed monotonic active time without clamping it to the cap, and closes `activeInterval` cleanly. Resume observation only after a fresh authorized invocation with supported checkpoint recovery and positive remaining active time, including an explicitly approved increase when the cap was exhausted; otherwise use the inspection workaround. No remote cancellation is implied.
- Minimal recovery: after a clean stop with a durable known ID, resume observation only if the existing checkpoint's supported recovery and remaining limits permit it; never claim all paused observations resume. For a crashed interval, use existing recovery/accounting procedures only when available and evidenced; otherwise stop. Workaround: preserve the local checkpoint and displayed ID, inspect status locally; with separate approval and applicable terms, the operator may check that ID through the provider's own interface. Keep the gap and do not issue a replacement submission or manually import results as though recovered; if no ID is known, consult provider support/account history where available, retain the gap, and do not retry that cell. A new crawl is a separate potentially billable operation and requires explicit approval; it does not repair the old checkpoint. No automatic reconciliation or remote cancel is promised.
- Bind persisted provider run to its non-secret query, geometry and provider mode; reject mismatched resume before transport or checkpoint mutation. Preserve exclusive ownership and offline fixture compatibility. Single-process operation is the supported scenario, not a promise to defend against a hostile local process.
- Authorization: D uses synthetic data only; D1 and E use synthetic transport only; they cannot reach real HTTP, even with a key or caller-supplied evidence/approval booleans. Slice F owns the sole production real-HTTP entry. Before enabling it, the operator verifies and records locally references and dates for current applicable technical request/lifecycle documentation, account/dataset pricing and terms covering intended collection, storage and export; no secrets or raw data in that record. The CLI defaults to blocked when any evidence is absent or does not cover the invocation, and reports the missing category. Before each live start or resume, display the effective query, bounds, limits, operation and an evidence-backed cost estimate with its assumptions and uncertainties; require fresh affirmative operator confirmation for that displayed invocation. Decline or missing confirmation means zero real requests. This is a simple local operator attestation, not independent legal verification or protection against hostile local actors; no PTY machinery. Approval is not provider evidence, a pricing quote or a rights grant. If no estimate can be made from applicable evidence, block the invocation; an estimate is neither a quote nor a guaranteed cost cap. Do not build a pricing engine. No paid call, publication or external account change is authorized by this draft.

### Priority and prior-gate reassessment
In the supported local single-operator scenario, duplicate paid work from an uncertain send, leaked credentials, silent failure and unbounded work have direct P0/P1 impact; retain dispatch/ID durability, bounded work, redaction and honest stops. Full durable poll-budget scheduling across restarts, exact-ID-only resume, extensive PTY anti-buffer checks, separate post-cutoff observation budget, automatic reconciliation and signal-specific race matrices cost substantial work beyond the demonstrated scenario. The documented stop/preserve/inspect workaround limits harm; propose deferring these as P2 when applicable, not silently removing an approved gate. The operator approved the revised brief in place of the earlier acceptance contract; release-impact grade is not a waiver of its required gates. Reassess if evidence or scope grows. Terminal confirmation is a proposed simpler consent mechanism, not a substitute for authorization or terms. Do not expand this workstream to handle speculative concurrency or providers.

### Existing work and reconciliation
Slice A was reviewed clean under the old plan; its `createBrightDataDiscoveryAdapter` is a disabled seam, not a working HTTP route. Slice B has commit `f58142a` and uncommitted changes in `src/durable-discovery.ts`, `src/durable-state.ts`, `src/traversal.ts`, `test/durable-discovery.test.mjs` and `.solopowers/wsd/bright-data-discovery/implementer-B-report.md`. Preserve all existing work, including the report; do not reset, overwrite, stash, cherry-pick or discard it. Before implementation, inspect committed and uncommitted diffs, establish build and focused/full test baseline, and map each piece to the approved revised behavior; preserve compatible work, adapt only with owner agreement where it conflicts, and report anything unverified or unsuitable. No existing review or commit implies the combined B work is correct or usable. If safe reconciliation cannot be established without discarding or changing user work, stop for operator direction. New slice IDs below describe proposed milestones, not retroactive acceptance of old A/B.

### Implementation discretion
Internal helpers, names, test fixture values and decomposition are implementation choices, within the above contract.

### Unresolved design blockers
The revised brief has operator approval following internal and external review. Current applicable provider operation, pricing and rights evidence is not established by the probe. If evidence implies materially different behavior or recovery, stop and return to the operator; no live route may be enabled by assumption.

## Final verification
- [ ] `mise install`; `mise exec -- npm ci`.
- [ ] Build before every focused RED/GREEN run and full check: `mise exec -- npm run build` (tests import `dist/`).
- [ ] `mise exec -- npm run check`; every required final check must pass. No live calls. Record actual results and distinguish unchanged baseline failures; do not waive required gates.
- [ ] Preserve the completed internal and external reviews and operator approval; a separately authorized bounded live demonstration is not implied by offline acceptance.

## Slices

### Slice D: Documented request and response mapping
**Goal:** Independently test pure, evidence-backed single-cell request and response mapping with synthetic data. No timeout handling, orchestration, transport or real HTTP.

#### Tasks
- [ ] Reconcile existing A/B work as above without disturbing incompatible B work; carry its clean-stop/resume incompatibility to E. Record current documentary evidence and probe limitations without raw data. Build and establish meaningful behavioral RED for each mapping contract before implementation. Map only documented and understood request fields and 202/ID, progress, retrieval and result/error variants; leave unresolved operations disabled.
- [ ] Test malformed fields, unknown statuses and 429 classification, sanitized errors and candidate-only identity. Test exactly `limit_per_input` without a marker as potentially capped with candidates retained, a gap and no expansion. Do not extract phone/site or introduce details or a framework. Mapping retry-after where documented does not implement waiting.
- [ ] Run focused and full checks; commit only verified changes, preserving unrelated work.

#### Watch out
202 and ten records are one sample, not a contract. Pure mapping must not enable a request; a real key must not itself enable calls.
#### Verification
`mise exec -- npm run build`; `mise exec -- node --test test/bright-data-discovery.test.mjs`; `mise exec -- npm run check`. Build before focused RED/GREEN and full checks; save behavioral RED evidence.
#### Carry-forward
Documentary evidence, pure request and response mappings, normalized candidate observations and explicit unresolved variants for D1; no transport or deadline behavior is claimed.

### Slice D1: Synthetic asynchronous handoff
**Goal:** Independently test injected synthetic asynchronous single submission/observation handoff using D's mappings, with explicit timeout and uncertain-send outcomes and a durable executor boundary; no production HTTP.

#### Tasks
- [ ] After D, build and establish meaningful behavioral RED for each handoff contract before implementation. Use injected synthetic transport only for a single submission or observation; no polling scheduler or real network. Keep the production adapter disabled and unresolved operations unavailable.
- [ ] Test finite per-request and observation bounds, documented retry-after handling, unknown status and 429 stops, sanitized failures and late results. Bound waits by remaining active time, initiate no more requests at cutoff, ignore late results and do not expand. Explicitly distinguish a returned ID available at cutoff, which must be handed to the durable executor for persistence before observation along with a gap, from a timed-out unacknowledged send, which is uncertain and must never trigger a blind resend. Define and test the handoff so E owns durable dispatch-before-send, ID-before-observation, clean stop/accounting and recovery; do not claim persistence from synthetic handoff tests alone.
- [ ] Run focused and full checks; commit only verified changes, preserving unrelated work.

#### Watch out
A local timeout does not cancel remote work. Never infer a missing ID means no submission. No key, evidence or approval boolean may enable real HTTP here.
#### Verification
`mise exec -- npm run build`; `mise exec -- node --test test/bright-data-discovery.test.mjs`; `mise exec -- npm run check`. Build before focused RED/GREEN and full checks; save behavioral RED evidence.
#### Carry-forward
D's mappings plus evidence-scoped synthetic async handoff, bounded failure and uncertain-send outcomes, and explicit durable executor obligations for E. E must reconcile B's incompatible clean-stop/resume semantics without discarding dirty work.

### Slice E: Connect durable traversal and recovery
**Goal:** Connect synthetic transport to bounded SQLite traversal with honest stop and uncertainty semantics; real HTTP remains unreachable.

#### Tasks
- [ ] Characterize fixture behavior and verify relevant RED after build. Adapt compatible existing B work, retain synchronous fixture callers, dispatch-before-send and ID-before-poll, and avoid transactions across I/O. Record IDs and local gaps; never resend unknown sends. Enforce independent limits, single owner and bound query/mode; apply the active-time observation cutoff to provider execution only, preserving fixture-mode eligibility for known IDs and the synchronous `executeDurableDiscovery` interface. Retain `detailWork` linkage for partial/potentially capped candidates, including any optional candidate name provenance, and update `validateTraversal` closed outcome and gap-cause enums for supported new values.
- [ ] Synthetic restart tests cover crash after dispatch before ID, known-ID clean pause and permitted resume, unknown or exhausted observation, failures versus empty, expansion on understood below-limit nonempty results and partial/potentially capped gaps. With a deterministic clock and releasable synthetic request, cross the active cutoff during observation, assert bounded local stop, actual elapsed monotonic time settled without clamping, persisted ID/gap and a closed `activeInterval`, with no further requests or expansion even after late release; then verify a fresh resume with approved increased budget and supported recovery does not become `recoveryPending` because of that clean stop. Check fixture known-ID eligibility at an exhausted active-time limit and the synchronous interface remain unchanged. Round-trip partial/potentially capped candidates through checkpoint validation with their `detailWork` linkage and supported outcome/gap enums. Exercise the unsupported recovery workaround in status; do not assert automatic recovery for every case.
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
- [ ] Establish meaningful RED after build; wire CLI/operator start, status, supported resume and export to the durable path. Implement the sole production real-HTTP entry and default-blocking operator evidence record and fresh invocation confirmation described above. Validate binding and evidence before mutation or transport; preserve IDs and actionable gaps, redact secrets and raw provider errors. Existing adapter booleans or a production test seam must not silently authorize a paid call. Test missing each evidence category and declined/missing confirmation with zero real requests using synthetic transport; test an affirmative confirmation against the displayed effective invocation. One synthetic confirmation test must assert an evidence-backed estimate with assumptions and uncertainty is displayed, and that an invocation for which no estimate can be made is blocked with zero requests.
- [ ] Synthetic CLI acceptance covers one seed, bounds and caps, below-limit nonempty expansion, empty, failure, exact-limit potentially capped/partial, uncertain send, known-ID stop, no automatic unsafe resend, candidate provenance, fixture compatibility and direct API notice. Document exact local recovery workaround, evidence/confirmation procedure and dense-seed limitation in `README.md`; no live data in tests or examples.
- [ ] Run focused and full checks and commit verified changes only.

#### Watch out
Operator approval does not establish terms or price; a local stop does not cancel a remote job. Preserve exact v1 fixture `OperatorStatus`, `OperatorExport`, and CLI start preflight shapes; provider-specific IDs, gaps and confirmation previews must not alter them. Add focused synthetic exact-shape checks for fixture status, export and preflight.
#### Verification
`mise exec -- npm run build`; `mise exec -- node --test test/operator-acceptance.test.mjs test/operator-cli.test.mjs test/bright-data-discovery.test.mjs`; `mise exec -- npm run check`.
#### Carry-forward
Offline evidence of the connected path; any live demonstration requires separate authorization and applicable evidence.
