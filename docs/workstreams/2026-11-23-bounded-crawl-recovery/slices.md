# Bounded Crawl Recovery Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Deliver a decision-complete Milestone 1 research handoff for a bounded offline reactive crawl and recovery contract, with synthetic scenario traces and explicitly sourced provider unknowns.

## Scope
**In scope**
- Geometry, connected traversal, budgets, accounting, recovery, coverage reporting and offline acceptance scenarios.
- Evidence review and a handoff identifying provider-specific integration blockers.

**Out of scope**
- Implementation, production code, live or paid calls, publishing, account actions, geocoder selection and multi-operator coordination.

## Key files
- `docs/milestones/01-contracts-and-boundaries.md`: milestone boundary.
- `docs/milestones/02-offline-reactive-slice.md`: downstream consumer.
- `docs/research/legacy-reactive-crawl.md`: legacy evidence, not validated implementation.
- `docs/research/bright-data-mcp.md`: provider evidence and unresolved contracts.
- `docs/research/location-input-contract.md`: location boundary.
- `docs/research/bounded-crawl-recovery.md`: intended research handoff.

## Architecture invariant
One operator supplies exactly one operator-confirmed coordinate or resolved location as seed, a crawl keyword, explicit country context where required, and an explicit radius or bounding box. Preserve the upstream input contract in `docs/happy-path.md` and `docs/research/location-input-contract.md`; resolution alone is not confirmation. No secrets or real customer data in artifacts. Synthetic examples are not evidence of provider behavior. Preserve source citations and distinguish facts, decisions and unknowns.

## Assumptions and design decisions
- Operator-configured grid spacing and independent paid submission, cell and active-time caps bound separate resources; a single combined limit is rejected because it cannot control each dimension. Charge every potentially billable submission against the attempt cap, including failed, empty and uncertain submissions; the cap does not bound billed records or monetary spend. Pricing evidence is insufficient to calculate worst-case cost. Assumes finite valid values; reopen if feasibility evidence shows another safety dimension is mandatory.
- Active time includes waits and backoff, excluding deliberate pauses and downtime. Explicit increases preserve cumulative totals, not reset them. This rejects elapsed wall time and budget resets; assumes durable accounting can represent pause boundaries, which offline research must specify.
- Reliable place coordinates yield inside or outside; missing or unreliable coordinates are unverified and reported separately. Reject treating unverified as outside or inside. Reopen if trustworthy coordinate semantics cannot be established.
- Initial offline scope rejects antimeridian-crossing and pole-containing areas rather than inventing wrapping geometry. Reopen only with an explicit geometry extension.
- Successful nonempty raw discovery expands to cardinal neighbors, irrespective of later filtering; empty success does not expand and failures never expand. Reject filtered-result-driven or failure-driven expansion because either obscures coverage. Assumes deterministic grid identity and bounded eligibility; define them in the handoff without claiming complete geographic coverage.
- Isolated exhausted failures create a recorded gap and allow other queued work; global failures pause. Reject silent dropping and automatic global retries. Define classification as provider-independent categories and flag provider mapping as unknown.
- Operator sets a finite retry cap; retry only known safe transient cases. Count every paid resubmission and detail request toward the paid submission cap. Reject unlimited or presumed-safe retries. Assumes paid attempt accounting can be conservative when outcomes are unknown.
- Uncertain paid sends pause; recover known identifiers where possible. Resend only with operator approval; skipping continues with a gap and conservative accounting. Reject automatic resend and forgetting uncertain spend. Provider idempotency, lookup, billing and error semantics require evidence before integration.
- A single operator and already resolved location avoid inventing coordination or a geocoder contract; reopen if product scope changes.

### Implementation discretion
Names, document organization and synthetic fixture values are local choices, provided scenarios expose each contract and do not assert provider guarantees.

### Unresolved design blockers
None for research approval. Provider-specific identifiers, safe retry classification, submission acceptance, recovery and billing guarantees remain explicitly unresolved integration blockers; do not infer them from absence of evidence.

## Final verification
Record exact results; all applicable required checks must pass before handoff.
- [ ] `mise install`
- [ ] `mise exec -- npm ci`
- [ ] `mise exec -- npm run check` (project tests, type check, lint and formatting as configured)
- [ ] Inspect handoff against every decision and synthetic scenario, with citations and provider unknowns distinguished.

---

## Slices

### Slice A: Evidence and bounded traversal contract

**Goal**: Research geometry, grid, traversal, classifications and independent budgets for the offline slice.

#### Tasks
- [ ] Read the milestone, happy path, roadmap, priority guidance and existing research handoffs; cite relevant evidence in `docs/research/bounded-crawl-recovery.md`.
- [ ] Define input validation preserving the confirmed single seed, keyword and required country context, boundary inclusion, cell identity and eligibility, duplicate handling, connected cardinal expansion, result classification and coverage limitations. Cite `docs/happy-path.md` and `docs/research/location-input-contract.md`; do not select a geocoder.
- [ ] Define each cap's unit, enforcement point, cumulative accounting, active-time boundaries and cap-increase behavior. Count every potentially billable submission, including detail requests, paid resubmissions, failed, empty and uncertain submissions. Explain that attempt caps do not bound billed records or spend; leave monetary bounds unresolved pending pricing evidence.
- [ ] Provide synthetic traces covering boundary cases, empty and nonempty discovery, duplicates, unverified coordinates, rejected geometries and each independent cap. Specify distinct partial outcome and reporting states for empty success, failed or unrecognized response, limits, cancellation and queue exhaustion with unresolved gaps.
- [ ] Run project checks and record results; no implementation or live calls.

#### Watch out
Raw discovery and filtered output are different; no claim of exhaustive coverage follows from connected traversal.

#### Verification
- `mise install`, `mise exec -- npm ci`, `mise exec -- npm run check`; review scenario traces for unambiguous outcomes.

#### Carry-forward
The handoff's geometry, traversal, accounting and coverage vocabulary anchors recovery scenarios.

### Slice B: Recovery and provider unknowns

**Goal**: Complete the handoff with safe failure handling and a decision-ready offline acceptance matrix.

#### Tasks
- [ ] Define isolated versus global failure, finite retries, gap records, pause/resume and conservative accounting; distinguish known-safe transient failures from unknowns.
- [ ] Trace synthetic exhausted isolated failure with continued work, global pause, uncertain paid send, identifier recovery, operator-approved resend and operator-selected skip with gap. Include caps across pauses and increases and a detail request.
- [ ] Cover distinct crash windows from `docs/research/bright-data-mcp.md` (Duplicate-paid-request crash windows and idempotency): durable intent before submission; lost acknowledgment before ID persistence; failed polling or fetching of a known ID; interrupted discovery-to-detail fan-out. For each trace show durable checkpoint state, cumulative attempt accounting and permitted next action.
- [ ] Specify and trace cancellation and time-cap stop when a submission may already have been accepted, and reporting for partial outcomes and queue exhaustion with unresolved gaps. A local stop proves neither provider cancellation nor non-billing; retain uncertainty and conservative accounting across restart.
- [ ] Document evidence-backed provider facts with citations and list unresolved submission, retry, lookup, billing and idempotency questions as integration blockers; never manufacture a contract.
- [ ] Review all brief decisions against the handoff and run the full project-required checks; report failures accurately.

#### Watch out
A synthetic successful recovery is not proof that a provider supports it. No paid calls or external account actions are authorized.

#### Verification
- `mise install`, `mise exec -- npm ci`, `mise exec -- npm run check`; verify each scenario has an explicit outcome and accounting state.

#### Carry-forward
Milestone 2 can consume the offline acceptance contract; provider integration must resolve documented unknowns separately.
