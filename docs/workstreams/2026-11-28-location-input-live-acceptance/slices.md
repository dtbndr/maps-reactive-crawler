# Location Input and Live Acceptance Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Enable deliberate location selection for an independently operated bounded crawl and establish connected synthetic acceptance, while preserving the milestone's separately authorized live-demo-or-blocker outcome.

## Scope
**In scope**
- Standalone Nominatim Search-compatible text resolution and candidate confirmation, coordinate-start boundaries, safe persistence and connected synthetic tests; milestone evidence and current-risk reassessment before any proposed live demo.

**Out of scope**
- Geoapify (#11), automatic location selection, aggregate traffic coordination, provider service guarantees, and #7 (v2 export optional-format typing), #8 (operator/v2 import cycle), #9 (synthetic v2 export milestone dependency), and #10 (owner-liveness status projection coverage) unless separately justified and approved. No live calls, credentials, account changes or publication are authorized by this plan.

## Key files
- `src/cli.ts`, `src/operator.ts`, `src/terminal-prompt.ts`: operator input and confirmation boundaries.
- `src/durable-state.ts`, `src/durable-discovery.ts`, `src/durable-bright-data-submission.ts`: checkpoint, recovery and submission boundaries.
- `src/traversal.ts`, `src/provider-preview.ts`: bounded traversal and existing preview gate.
- `test/*.test.mjs`: synthetic tests; identify exact seams against current code before editing.
- `docs/research/location-input-contract.md`, `docs/research/bounded-crawl-recovery.md`, `docs/happy-path.md`: evidence and acceptance boundaries.

## Architecture invariant
For text, a confirmed candidate precedes coordinate handoff; fixture coordinate starts are the explicit non-interactive exception to post-preview confirmation. Bright Data’s existing affirmative preview confirms the displayed seed and action before credential access, checkpoint creation and dispatch; resume uses stored seed without resolving it or duplicating previously dispatched work; permitted new work may still be admitted. Keep the existing Bright Data preview and affirmative gate independent of geocoder confirmation. Checkpoint/export only minimal approved seed data, not raw candidate payloads without rights evidence. Never describe synthetic evidence as live identity, details, completeness or coverage evidence.

## Assumptions and design decisions
- **Provider model:** operator configures a Nominatim Search-compatible endpoint and can switch it without a software update; explicit public endpoint selection, never a shared default. Independent operators own service choice and obligations; no project-run coordination or SLA. Rejected: central proxy/shared default or blocking progress on aggregate guarantee. Assumes chosen endpoint supports documented [Search API](https://nominatim.org/release-docs/latest/api/Search/); incompatible services fail visibly. Reopen on changed contract or unsafe supported use.
- **Public policy:** [OSMF policy](https://operations.osmfoundation.org/policies/nominatim/) limits aggregate traffic per application/website to an absolute maximum of one request per second, permits directly user-triggered searches with moderate users, requires identifying User-Agent or Referer, attribution and caching, and prohibits autocomplete; bulk/periodic use has additional restrictions. Serialize requests across processes sharing the same operator-local cache, including retries, with at least 1.1 seconds between starts, no autocomplete, and surface throttling/denial. Rejected: claiming this local limiter ensures aggregate compliance. Public service may throttle or deny; policy and selected-service terms must be rechecked before implementation and live use.
- **Cache:** persist validated query results, including empty results but not failures, scoped to endpoint, normalized query and country across process restarts in an operator-owned local cache location documented for configuration and deletion. Coordinate cache lookup, request and spacing across processes sharing that cache, including rapid restarts; prevent overlapping requests when safe spacing cannot be established. A crashed lock holder must fail closed: detect stale ownership safely where possible, otherwise require documented operator recovery rather than guessing or waiting indefinitely. Detect wall-clock regression against persisted request timing and fail closed until safe spacing is established or documented operator recovery resolves it; never assume cross-machine clock or lock coordination. Retain only candidate coordinates, display label and country evidence needed for selection and validation, plus required attribution; reuse for repeated identical searches until operator removes the cache, subject to applicable retention terms. No automatic expiry that causes repeated requests; document operator deletion and data obligations. Avoid sharing across endpoints or countries. Rejected: process-only cache and uncached repeats. Reopen if current provider terms disallow this lifetime or retained fields; do not silently store raw candidates in checkpoints or exports.
- **Selection and handoff:** A standalone location command requires text and country, displays candidates with country context and requires explicit candidate selection and confirmation even for one. It outputs validated coordinates at round-trip precision and country context, not raw payload, evidence or authorization; it creates no crawl checkpoint and calls no crawl provider. The operator prepares all five existing attestations for the full intended invocation, then uses those exact coordinates and provider country in the existing coordinate start with evidence; no re-geocoding or rounding. A changed seed requires matching evidence. No single-command text start is planned. Cancellation, EOF, invalid input, lookup or confirmation errors create no checkpoint and dispatch nothing. Distinguish empty results from service, malformed-response and rate-limit errors; reject unverifiable or mismatched country rather than guessing. Rejected: silent first result, inferred US, lookup fallback or changing exact-invocation attestation.
- **Country representation:** Validate ISO 3166-1 alpha-2 country input; normalize case consistently for comparison and cache keys, send lowercase `countrycodes` to Nominatim and request `addressdetails=1`. Validate the structured `address.country_code` against the requested country, not display-name text. Use uppercase for Bright Data `--country`; the operator must use the same country as confirmed lookup context, with case normalization only, never substitution of a different country. Coordinates retain independently specified provider country.
- **Coordinate starts:** Preserve non-interactive fixture coordinate starts and their existing notice; explicit coordinates are not post-preview confirmation, and this fixture-only exception does not extend to text selection or Bright Data. For Bright Data, show effective seed and country in the existing preview and make its one affirmative TTY prompt explicitly confirm both seed and proceeding; retain exact evidence checks and gate before credentials, checkpoint and dispatch. Decline or unavailable confirmation must not access credentials, create a checkpoint or dispatch. No second coordinate prompt; selection is not paid-call consent.
- **Recovery and authorization:** retain only the minimum confirmed seed needed by traversal and recovery, subject to applicable rights; do not persist raw candidates as checkpoint/export data without evidence. Rejected: geocoding on resume or treating selection as Bright Data approval. Reopen if required persistence rights cannot be established.
- **Milestone:** synthetic connected tests are necessary but not live proof. Before a separately authorized demo reassess #4 (unsupported Retry-After visibility), #5 (back-to-back running-snapshot polling), current provider contract, data rights, pricing and operational risks; unbounded risk is a documented blocker. Paid approval must explicitly state uncertain cost and work/stop limits. Rejected: automatic paid call or treating demo as mandatory despite blockers.

### Implementation discretion
Naming, helper decomposition, test fixtures and local type mechanics are implementation choices within these boundaries.

### Unresolved design blockers
Current service terms and rights for retained seed/cache fields must be checked before provider implementation or use; if incompatible, stop for operator decision. Actual live-demo eligibility is separately assessed, not assumed.

## Final verification
- [ ] `mise exec -- npm run check` (includes typecheck, tests and build); record exact output. No separate linter or formatter script is configured.
- [ ] Record connected synthetic evidence, stops and visible coverage limitations; document separately authorized demo results or blockers. Every required check must pass for workstream completion.

## Slices

### Slice A: Confirmed location input
**Goal**: Establish standalone country/text selection and the existing coordinate-start confirmation boundaries without provider dispatch.

#### Tasks
- [ ] In the CLI/operator input seam, add synthetic tests first for missing country, multiple and single candidate confirmation, mismatch, empty result versus error, coordinate starts bypassing lookup, the non-interactive fixture exception, and Bright Data single-preview confirmation; verify meaningful RED.
- [ ] Implement standalone input/confirmation and exact coordinate output; preserve fixture non-interactivity and the Bright Data preview boundary.
- [ ] Run focused tests, then `mise exec -- npm run check`; record results and commit only after verification.

#### Watch out
Do not infer country, auto-select, or treat selection as paid-call consent.

#### Verification
Synthetic tests exercise each outcome without network; full check passes.

#### Carry-forward
A resolver interface with a synthetic implementation supplies candidates before confirmation; the confirmed, validated seed and country context are available for the manual evidence and coordinate-start handoff.

### Slice B: Configurable Nominatim resolution and cache
**Goal**: Implement the documented Search contract and operator-scoped policy safeguards with synthetic transport.

#### Tasks
- [ ] Recheck documented Search and policy/rights before implementation; stop for decision if incompatible. Add RED synthetic tests for configured endpoint switching, explicit public selection, request country/identification, attribution, errors, validated empty-result caching versus failures, cache restart/scope and attribution on fresh and cached results, structured country details and case normalization, cross-process overlap and restart spacing including retries, stale-lock crash/recovery and clock regression fail-closed behavior, and no autocomplete.
- [ ] Implement minimal resolution and persistent cache per decisions; document operator responsibilities and public policy limitations.
- [ ] Run focused tests and `mise exec -- npm run check`; record results and commit after verification.

#### Watch out
No live provider calls; safeguards coordinate only processes using the same local cache, not separate caches, installations or machines, and cannot enforce aggregate limits. Do not mistake cache persistence for export rights.

#### Verification
Synthetic transport and controlled clock demonstrate contract and spacing; separate processes demonstrate cache reuse, exclusion and restart spacing; full check passes.

#### Carry-forward
Confirmed selected coordinates can be handed off exactly to the coordinate workflow without leaking raw candidate payloads.

### Slice C: Connected bounded acceptance and recovery
**Goal**: Prove the selected seed reaches bounded traversal and safe fresh-process recovery.

#### Tasks
- [ ] Add RED connected synthetic tests capturing confirmed standalone resolver output from the first process, building matching synthetic evidence for the full invocation from that output, and launching coordinate start in a second process through real preview, affirmative dispatch, checkpoint, bounded crawler, stop reasons and visible coverage limitations. Assert exact seed reaches traversal without geocoding; mismatched evidence blocks before dispatch, without pre-baking coordinates or hiding mismatch. Test fresh-process resume with stored seed and no geocoding or duplicate dispatch. Use a checkpoint with one known in-flight provider ID and no new admissions, observing that ID.
- [ ] Extend the production CLI subprocess harness in `test/provider-cli-production.test.mjs` with injected synthetic transport and scripted confirmation, asserting seed and country appear before one affirmative prompt and exercising the real preview, decline and unavailable-confirmation behavior without credentials or network; assert no credential access, checkpoint or dispatch on decline or unavailable confirmation. Preserve the existing fixture CLI regression. Run the focused test with `mise exec -- node --test test/provider-cli-production.test.mjs`.
- [ ] Implement only necessary integration; preserve existing Bright Data gate and minimal retained data. Inspect checkpoint and export fixtures for raw candidate leakage.
- [ ] Run focused tests and `mise exec -- npm run check`; record results and commit after verification.

#### Watch out
Synthetic result identity and behavior do not prove live identity, details, completeness or coverage.

#### Verification
Assert selected coordinates at traversal boundary, work limits, visible stop/coverage output, and, in that same fresh-process resume, stored geometry, zero resolver calls, observation of the known ID and no duplicate dispatch (zero submissions only because the fixture admits no new work); full check passes.

#### Carry-forward
A reproducible synthetic acceptance record and scoped limitations support the milestone assessment.

### Slice D: Milestone acceptance and live readiness
**Goal**: Record evidence for a separately approved bounded demo or documented blockers.

#### Tasks
- [ ] Reassess #4 (unsupported Retry-After visibility), #5 (back-to-back running-snapshot polling), current provider contracts, rights and pricing, unknown cost, work and stop limits; document material unbounded risk as a blocker. Consider #7 (v2 export optional-format typing), #8 (operator/v2 import cycle), #9 (synthetic v2 export milestone dependency), and #10 (owner-liveness status projection coverage) only on evidence of first-release P0/P1 impact and separate scope approval.
- [ ] Request separate explicit authorization before any live or paid call; before spend provide an estimate including any inability to bound cost and proposed work/stop limits, and wait for explicit approval stating uncertain cost and those limits. Do not collect secrets in artifacts. If a run occurs, record actual cost and limitations in `docs/milestones/03-provider-integrations.md`; otherwise record precise blockers there, not fabricated demonstration evidence or a successful live validation.
- [ ] Run `mise exec -- npm run check`, record exact outcomes and commit documentation after verification.

#### Watch out
Approval of this plan is not live-call, paid-call, account, publication or secret-handling authorization.

#### Verification
Milestone record contains bounded separately authorized demo evidence or precise blockers; all required checks pass.

#### Carry-forward
Release decision receives actual evidence and remaining limitations, not implied live validation.
