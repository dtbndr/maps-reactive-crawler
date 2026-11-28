# Location Input and Live Acceptance Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Enable deliberate location selection for an independently operated bounded crawl and establish connected synthetic acceptance, while preserving the milestone's separately authorized live-demo-or-blocker outcome.

## Scope
**In scope**
- Nominatim Search-compatible text resolution, coordinate confirmation, safe persistence and connected synthetic tests; milestone evidence and current-risk reassessment before any proposed live demo.

**Out of scope**
- Geoapify (#11), automatic location selection, aggregate traffic coordination, provider service guarantees, and #7–#10 unless separately justified and approved. No live calls, credentials, account changes or publication are authorized by this plan.

## Key files
- `src/cli.ts`, `src/operator.ts`, `src/terminal-prompt.ts`: operator input and confirmation boundaries.
- `src/durable-state.ts`, `src/durable-discovery.ts`, `src/durable-bright-data-submission.ts`: checkpoint, recovery and submission boundaries.
- `src/traversal.ts`, `src/provider-preview.ts`: bounded traversal and existing preview gate.
- `test/*.test.mjs`: synthetic tests; identify exact seams against current code before editing.
- `docs/research/location-input-contract.md`, `docs/research/bounded-crawl-recovery.md`, `docs/happy-path.md`: evidence and acceptance boundaries.

## Architecture invariant
A confirmed seed precedes checkpoint creation and dispatch; resume uses stored seed without resolving it or duplicating previously dispatched work; permitted new work may still be admitted. Keep the existing Bright Data preview and affirmative gate independent of geocoder confirmation. Checkpoint/export only minimal approved seed data, not raw candidate payloads without rights evidence. Never describe synthetic evidence as live identity, details, completeness or coverage evidence.

## Assumptions and design decisions
- **Provider model:** operator configures a Nominatim Search-compatible endpoint and can switch it without a software update; explicit public endpoint selection, never a shared default. Independent operators own service choice and obligations; no project-run coordination or SLA. Rejected: central proxy/shared default or blocking progress on aggregate guarantee. Assumes chosen endpoint supports documented [Search API](https://nominatim.org/release-docs/latest/api/Search/); incompatible services fail visibly. Reopen on changed contract or unsafe supported use.
- **Public policy:** [OSMF policy](https://operations.osmfoundation.org/policies/nominatim/) limits aggregate traffic per application/website to an absolute maximum of one request per second, permits directly user-triggered searches with moderate users, requires identifying User-Agent or Referer, attribution and caching, and prohibits autocomplete; bulk/periodic use has additional restrictions. Serialize requests across processes sharing the same operator-local cache, including retries, with at least 1.1 seconds between starts, no autocomplete, and surface throttling/denial. Rejected: claiming this local limiter ensures aggregate compliance. Public service may throttle or deny; policy and selected-service terms must be rechecked before implementation and live use.
- **Cache:** persist validated query results, including empty results but not failures, scoped to endpoint, normalized query and country across process restarts in an operator-owned local cache location documented for configuration and deletion. Coordinate cache lookup, request and spacing across processes sharing that cache, including rapid restarts; prevent overlapping requests when safe spacing cannot be established. Retain only candidate coordinates, display label and country evidence needed for selection and validation, plus required attribution; reuse for repeated identical searches until operator removes the cache, subject to applicable retention terms. No automatic expiry that causes repeated requests; document operator deletion and data obligations. Avoid sharing across endpoints or countries. Rejected: process-only cache and uncached repeats. Reopen if current provider terms disallow this lifetime or retained fields; do not silently store raw candidates in checkpoints or exports.
- **Selection:** country is required for text, sent as documented country-code filter; display candidates and require explicit selection/confirmation even for one. Start accepts exactly one mode: text plus required lookup country, or both latitude and longitude; reject mixed, partial or missing inputs. For Bright Data text starts require lookup country and existing `--country` to agree after validation, without inference or silent rewriting; coordinates retain the independently specified provider country. Display effective seed and country context before confirmation. Cancellation, EOF, invalid input and lookup or confirmation errors leave no checkpoint and cause no dispatch. Distinguish no results from service, malformed-response and rate-limit errors; do not accept a country mismatch as a match. Coordinates bypass lookup only after explicit confirmation. Rejected: silent first result, inferred US, and lookup fallback. Assumes candidate country evidence supports validation; fail visibly if not verifiable rather than guessing.
- **Recovery and authorization:** retain only the minimum confirmed seed needed by traversal and recovery, subject to applicable rights; do not persist raw candidates as checkpoint/export data without evidence. Rejected: geocoding on resume or treating selection as Bright Data approval. Reopen if required persistence rights cannot be established.
- **Milestone:** synthetic connected tests are necessary but not live proof. Before a separately authorized demo reassess #4/#5, current provider contract, data rights, pricing and operational risks; unbounded risk is a documented blocker. Paid approval must explicitly state uncertain cost and work/stop limits. Rejected: automatic paid call or treating demo as mandatory despite blockers.

### Implementation discretion
Naming, helper decomposition, test fixtures and local type mechanics are implementation choices within these boundaries.

### Unresolved design blockers
Current service terms and rights for retained seed/cache fields must be checked before provider implementation or use; if incompatible, stop for operator decision. Actual live-demo eligibility is separately assessed, not assumed.

## Final verification
- [ ] `mise exec -- npm run check` (includes typecheck, tests and build); record exact output. No separate linter or formatter script is configured.
- [ ] Record connected synthetic evidence, stops and visible coverage limitations; document separately authorized demo results or blockers. Every required check must pass for workstream completion.

## Slices

### Slice A: Confirmed location input
**Goal**: Establish explicit country/text selection and coordinate confirmation without provider dispatch.

#### Tasks
- [ ] In the CLI/operator input seam, add synthetic tests first for missing country, multiple and single candidate confirmation, mismatch, empty result versus error, and confirmed coordinate bypass; verify meaningful RED.
- [ ] Implement minimum input/confirmation flow; ensure no checkpoint or dispatch before confirmation.
- [ ] Run focused tests, then `mise exec -- npm run check`; record results and commit only after verification.

#### Watch out
Do not infer country, auto-select, or treat selection as paid-call consent.

#### Verification
Synthetic tests exercise each outcome without network; full check passes.

#### Carry-forward
A resolver interface with a synthetic implementation supplies candidates before confirmation; the confirmed, validated seed is available to the durable workflow.

### Slice B: Configurable Nominatim resolution and cache
**Goal**: Implement the documented Search contract and operator-scoped policy safeguards with synthetic transport.

#### Tasks
- [ ] Recheck documented Search and policy/rights before implementation; stop for decision if incompatible. Add RED synthetic tests for configured endpoint switching, explicit public selection, request country/identification, attribution, errors, validated empty-result caching versus failures, cache restart/scope and attribution on fresh and cached results, cross-process overlap and restart spacing including retries, and no autocomplete.
- [ ] Implement minimal resolution and persistent cache per decisions; document operator responsibilities and public policy limitations.
- [ ] Run focused tests and `mise exec -- npm run check`; record results and commit after verification.

#### Watch out
No live provider calls; safeguards coordinate only processes using the same local cache, not separate caches, installations or machines, and cannot enforce aggregate limits. Do not mistake cache persistence for export rights.

#### Verification
Synthetic transport and controlled clock demonstrate contract and spacing; separate processes demonstrate cache reuse, exclusion and restart spacing; full check passes.

#### Carry-forward
Confirmed selected coordinates feed the durable workflow without leaking raw candidate payloads.

### Slice C: Connected bounded acceptance and recovery
**Goal**: Prove the selected seed reaches bounded traversal and safe fresh-process recovery.

#### Tasks
- [ ] Add RED connected synthetic tests from selection through checkpoint, preview, affirmative dispatch, bounded crawler, stop reasons and visible coverage limitations; test fresh-process resume with stored seed and no geocoding or duplicate dispatch. Use a checkpoint with one known in-flight provider ID and no new admissions, observing that ID.
- [ ] Extend the production CLI subprocess harness in `test/provider-cli-production.test.mjs` with injected synthetic transport and scripted confirmation, exercising the real preview and decline behavior without credentials or network. Run the focused test with `mise exec -- node --test test/provider-cli-production.test.mjs`.
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
- [ ] Reassess #4/#5, current provider contracts, rights and pricing, unknown cost, work and stop limits; document material unbounded risk as a blocker. Consider #7–#10 only on evidence of first-release P0/P1 impact and separate scope approval.
- [ ] Request separate explicit authorization before any live or paid call; before spend provide an estimate including any inability to bound cost and proposed work/stop limits, and wait for explicit approval stating uncertain cost and those limits. Do not collect secrets in artifacts. If a run occurs, record actual cost and limitations in `docs/milestones/03-provider-integrations.md`; otherwise record precise blockers there, not fabricated demonstration evidence or a successful live validation.
- [ ] Run `mise exec -- npm run check`, record exact outcomes and commit documentation after verification.

#### Watch out
Approval of this plan is not live-call, paid-call, account, publication or secret-handling authorization.

#### Verification
Milestone record contains bounded separately authorized demo evidence or precise blockers; all required checks pass.

#### Carry-forward
Release decision receives actual evidence and remaining limitations, not implied live validation.
