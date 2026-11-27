# Bright Data Discovery Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Implement a safe, fixture-tested bounded discovery path where supported by verified contracts, otherwise document and enforce the affected blocker.

## Scope
**In scope:** Individual BYOK operator; confirmed coordinate, keyword, country, geographic bounds and independent cell, submission and active-time limits; project-owned scheduling, submission, bounded observation and recovery. Synthetic tests only.

**Out of scope:** Geocoding, details, verified place identity, real-data validation, publication, provider account changes and paid calls. No live probe or provider endpoint call is authorized. Separate approval requires an estimate with uncertainty and work/stop limits before any potentially billable call.

## Key files
- `src/traversal.ts`: bounded scheduling and transitions.
- `src/durable-discovery.ts`, `src/durable-state.ts`: durable execution and checkpoint ownership.
- `src/operator.ts`, `src/cli.ts`: operator entry and reporting.
- `src/bright-data-discovery.ts` (new): contract-gated transport adapter.
- `test/durable-discovery.test.mjs`, `test/operator-acceptance.test.mjs`, new `test/bright-data-discovery.test.mjs`: synthetic verification.
- `docs/research/bright-data-mcp.md`, `docs/research/bounded-crawl-recovery.md`, `README.md`: evidence and operator notice.

## Architecture invariant
No credentials in fixtures, logs, checkpoints or outputs. MCP is optional agentic assistance, never a runtime dependency. Keep durable scheduling and recovery project-owned; no provider operation is enabled on invented semantics. Direct API use must be disclosed in operator documentation. No implementation before approval of the brief.

## Assumptions and design decisions
- Direct HTTP is preferred to SDK because control of individual request attempts, IDs and checkpoint boundaries matters. Compare the official JavaScript SDK's supported method, retries, acknowledgment and ID access against pinned source/version evidence before choosing. SDK convenience is rejected unless equivalently controllable. Reopen if evidence invalidates the preference.
- The [Maps-specific discovery reference](https://docs.brightdata.com/api-reference/scrapers/search-engines-apis/google-maps-discover-by-location) documents synchronous request fields. Generic asynchronous trigger and snapshot documentation does not by itself establish the exact Maps async contract. Verify endpoint, parameters, field formats including country and coordinates/zoom, acknowledgment, result shape, statuses, pacing, retention, pagination and empty/partial/capped/error distinctions with dated authoritative sources. Do not infer from legacy behavior. A synchronous inline-result route is not an automatic fallback; it would need a separately designed durable result commit, not a fabricated ID. Reopen design if only that route is supported.
- Reserve and persist dispatch before any external send. Unknown acknowledgment retains the charged reservation and a visible gap; no automatic resend or invented lookup. Persist known snapshot ID before observing, and resume observation of that ID after restart. Any manual recovery must record credible evidence and preserve accounting; no unsafe automatic correlation. Authentication, configuration and accounting failures are global, not isolated empty results.
- Existing executor uses synchronous synthetic callbacks. Adapt its I/O boundary explicitly for awaited operations while retaining exclusive checkpoint ownership, active-time accounting, transactional ordering and crash recovery. Do not hold a SQLite transaction across network I/O. Bound individual request deadlines and total observation attempts/time durably across restart, including perpetually pending results. Exhaustion preserves ID and gap. Submission/time limits stop new work but do not alone prevent known-ID observation; local cancellation does not assert remote cancellation.
- Bound scheduled cell centers, not returned places; report non-exhaustive coverage and unresolved gaps. Discovery observations are candidates, not verified identities. Preserve successful empty versus failed, malformed, partial and capped outcomes without converting uncertainty to completeness.
- BYOK means `BRIGHT_DATA_API_KEY` comes from the operator; never read or expose the actual local key in planning, tests, logs or checkpoints. Explicitly document direct API use. Synthetic inputs and responses do not validate live behavior, pricing or rights. Applicable pricing, rights and provider recovery semantics remain separately gated.

### Implementation discretion
Local helper names, type spelling, synthetic data values and internal decomposition, provided the boundaries above remain intact.

### Unresolved design blockers
Maps-specific asynchronous submission and lifecycle evidence remains unverified. Disable affected live behavior and document precise evidence needed; do not claim a working integration. If resolving it requires a materially different recovery design, return to the operator for approval.

## Final verification
- [ ] `mise install`
- [ ] `mise exec -- npm ci`
- [ ] `mise exec -- npm run check` (project tests, type, lint and formatting checks as configured); all required checks must pass.

## Slices

### Slice A: Contract and transport boundary
**Goal:** Establish dated method-specific evidence and a fail-closed adapter boundary.

#### Tasks
- [ ] Update `docs/research/bright-data-mcp.md` with source URLs, evidence dates, direct HTTP versus SDK comparison, supported claims and gaps. No calls to provider APIs.
- [ ] In `src/bright-data-discovery.ts`, define explicit asynchronous submit and observe contracts with injected transport and a disabled unsupported route. Define validation and result classifications only to the extent evidence supports them.
- [ ] Add credential-free tests showing missing evidence disables the affected path and that request construction/redaction does not expose credentials. Establish meaningful RED before behavior changes.
- [ ] Run focused and full checks, distinguish baseline failures, and commit only after slice verification.

#### Watch out
A public sync example is not proof of async parity. Do not silently choose an endpoint.

#### Verification
`mise exec -- node --test test/bright-data-discovery.test.mjs`; `mise exec -- npm run check`.

#### Carry-forward
Documented contract matrix, adapter seam and explicit blockers.

### Slice B: Durable submission and observation
**Goal:** Preserve paid-work accounting and IDs across awaited I/O and crashes.

#### Tasks
- [ ] Characterize `src/durable-discovery.ts` and `src/durable-state.ts`; demonstrate RED for async dispatch ordering, lost acknowledgment, ID persistence and restart.
- [ ] Implement durable reserve/dispatch-before-send, ID-before-observation and explicit evidence-backed recovery. Persist finite observation budgets and deadlines across restart; preserve uncertainty and IDs on exhaustion/cancellation.
- [ ] Extend `test/durable-discovery.test.mjs` and focused recovery tests for crash before ID persistence, restart after ID persistence, perpetual pending, transient errors and no duplicate submissions.
- [ ] Run focused and full checks, distinguish baseline failures, and commit only after slice verification.

#### Watch out
No network I/O in an open SQLite transaction; do not mistake local cancellation for remote cancellation or conflate global failures with cell gaps.

#### Verification
`mise exec -- node --test test/durable-discovery.test.mjs test/durable-recovery.test.mjs`; `mise exec -- npm run check`.

#### Carry-forward
Async lifecycle contract, persistent observation budget and recovery transitions.

### Slice C: Bounded operator discovery
**Goal:** Wire the supported operator inputs to discovery when verified, and report blockers safely otherwise.

#### Tasks
- [ ] Establish RED in synthetic operator acceptance tests for confirmed seed, keyword, country, explicit bounds, independent caps, expansion and distinct empty/partial/capped/failed outcomes.
- [ ] Update `src/operator.ts` and `src/cli.ts` to select the contract-gated adapter without weakening fixture compatibility; expose limits, known IDs, uncertainty and coverage limitations. Retain candidate provenance without claiming identity.
- [ ] Update `README.md` for BYOK, direct API notice, optional MCP and unresolved live-use, cost and rights gates; never include actual credentials.
- [ ] Run focused and full checks, distinguish baseline failures, and commit only after slice verification.

#### Watch out
Fixture success is not provider validation; no detail collection or geocoding. Do not clear gaps on resume or label unsupported work successful.

#### Verification
`mise exec -- node --test test/operator-acceptance.test.mjs test/operator-cli.test.mjs test/bright-data-discovery.test.mjs`; `mise exec -- npm run check`.

#### Carry-forward
Credential-free acceptance evidence and explicit remaining contract blockers for later workstreams.
