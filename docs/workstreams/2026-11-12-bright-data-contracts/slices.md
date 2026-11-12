# Bright Data Contracts Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Produce a current, evidence-backed provider contract and explicit blockers for the first-release happy path, without executing a provider collection.

## Scope
**In scope**
- Public-source research into location discovery and details, MCP and direct API, lifecycle, cost, limits, failure modes and applicable terms.
- Durable, source-linked findings, implications for the reactive happy path, and separately approvable probe proposals where documentation is insufficient.

**Out of scope**
- Provider integration, live collection, paid calls, account changes, publication, real customer data or secrets.
- Selecting a geocoder or deciding geometry, retries or crash recovery; later Milestone 1 workstreams own those decisions.

## Key files
- `docs/research/bright-data-mcp.md`: existing provider research; update it as the durable contract handoff, preserving still-valid context and correcting stale claims.
- `docs/happy-path.md` and `docs/milestones/01-contracts-and-boundaries.md`: read-only acceptance and sequencing context.
- `docs/workstreams/2026-11-12-bright-data-contracts/`: planning artifacts and execution log, not the sole home for findings.

## Architecture invariant
A single-seed, bounded reactive crawler remains project-owned; MCP supports agentic work, not a mandatory runtime scheduler. No source assertion may become a runtime guarantee without evidence. Never store credentials, account-specific secrets or real customer data. Public-document research does not authorize provider collection or other external side effects.

## Assumptions and design decisions
- **Source-first contract:** Update the existing handoff rather than create a disconnected second source; its catalog-based observations are starting points, not current guarantees. Assumes public documentation is accessible; if not, record inaccessible sources and blocking unknowns rather than guessing. Reopen if sources show a materially different product or contract.
- **Evidence levels:** Label documented fact, inference and unresolved blocker separately, with source URL, relevant section or quoted claim, access date and version/effective date where available. Prefer current provider primary documentation, catalog and API reference; cross-check conflicts and mark account-specific or unverified claims. Reject treating secondary summaries or prior research as conclusive. Reopen conclusions when newer or conflicting authoritative evidence appears.
- **MCP versus API:** Compare actual supported operations, schemas, lifecycle and cost implications; recommend responsibilities with explicit direct-API notice, not a runtime integration choice. Reject assuming the catalog is equivalent to observed responses. Provider evidence may establish that detail necessity is unresolved rather than force a choice.
- **Safety and scope:** Research public material only; propose but do not perform probes, even if advertised as free. Reject live validation as a prerequisite for this planning workstream because approval and cost are separate. Each proposal specifies purpose, minimal inputs, expected billable exposure, data handling and approval needed; unknown costs remain unknown.
- **Later decisions:** Identify consequences for expansion, boundaries, work limits and duplicate-paid-request recovery without deciding geocoding or geometry/recovery policies. Reject speculative design commitments until subsequent workstreams combine the evidence.
- **Rights:** Describe applicable source terms, attribution and redistribution constraints with jurisdiction/account/version caveats; flag uncertainty for operator or legal review, not a legal conclusion. MIT licensing of project code does not confer data rights.

### Implementation discretion
- Research organization, source discovery method and concise synthetic examples, provided evidence labels and all acceptance topics remain clear.
- Whether to include supplementary research files if needed; link them from the existing handoff and keep each slice within 1–5 files.

### Unresolved design blockers
None for the research plan. Missing provider evidence is an output blocker for downstream implementation, not permission to speculate or perform a probe.

## Final verification
After all slices, run from the repository root:
- [ ] `git diff --check` passes; inspect new untracked research files too for whitespace.
- [ ] `mise install` and `mise exec -- npm ci` complete; then `mise exec -- npm run check` passes (typecheck, tests and build; no separate lint or formatter scripts are defined).
- [ ] Review the handoff against all acceptance topics and confirm source links, evidence labels, access dates, conflicts and unresolved blockers; verify no secrets, real customer data or unsupported runtime guarantees.
- [ ] Record any unavailable checks and reason; do not claim they passed. Commit each verified research slice within the chosen workstream isolation unit before review.

---

## Slices

### Slice A: Discovery and result contracts

**Goal**: Establish what a bounded location search can request and receive, and whether detail collection is necessary.

#### Tasks

**`docs/research/bright-data-mcp.md`**
- [ ] Before research, identify gaps in the current handoff for country, keyword, coordinates, zoom, required formats and outputs; this is the documentation-only equivalent of a failing acceptance check.
- [ ] Check current primary catalog, scraper and direct API documentation and MCP tool reference; cite exact locations and dates. Compare inputs, output fields and operation mapping; distinguish discovery URLs from place records and detail availability, coordinates and identifiers.
- [ ] State whether detail is documented as necessary, unnecessary, conditional or unknown for the happy path; identify completeness, coverage and expansion implications, without treating absence of documented fields as proof of absence.
- [ ] Classify facts, inferences and blockers; rerun the acceptance review to verify every gap is resolved or explicitly blocked with evidence and a proposed next step.

#### Watch out
Catalog optionality does not override the project's coordinate requirement; do not invent a country or infer a tested result shape. Public references may be versioned or conflict.

#### Verification
- `git diff --check` and inspect the updated handoff: each input/output and detail-necessity claim has a source or is explicitly unknown; MCP and direct API are compared.

#### Carry-forward
Source inventory, discovery contract and unresolved result-shape questions for lifecycle and cost investigation.

### Slice B: Lifecycle, limits and cost risks

**Goal**: Document operational behavior and potential duplicate billing without prescribing recovery policy.

#### Tasks

**`docs/research/bright-data-mcp.md`**
- [ ] List missing acceptance evidence for asynchronous trigger, snapshot identifiers, states, polling, retrieval, retention, cancellation, failures and partial results before research.
- [ ] Research limits, pagination, truncation, rate limits, retries, billing units and current published pricing for discovery and detail; include qualifiers and account-specific unknowns.
- [ ] Trace the submit/acknowledgment crash window and other duplicate-paid-request risks, identifying what documentation does or does not say about idempotency, lookup and billing. Do not select a retry/recovery design.
- [ ] Distinguish empty, failed, partial and capped results when supported by evidence; mark unknowns that block safe expansion or cost estimates and propose approval-gated probes if useful. Recheck the initial gap list.

#### Watch out
Do not infer a free allowance, a retry guarantee, a complete dataset, or failure semantics from silence. No provider run, even for a probe.

#### Verification
- `git diff --check` and inspect the lifecycle and cost sections for dated citations, explicit unknowns, failure distinctions and duplicate-charge risks.

#### Carry-forward
Operational contract and unresolved risks for terms and final synthesis.

### Slice C: Terms and synthesis

**Goal**: Complete a durable handoff usable by the following workstreams.

#### Tasks

**`docs/research/bright-data-mcp.md`**
- [ ] Identify missing source evidence for service and data terms, attribution, permitted use and redistribution; consult current primary provider and relevant third-party sources where applicable, noting versions, jurisdiction and applicability limitations.
- [ ] Summarize documented rights and restrictions separately from inference and legal/account-specific unknowns; flag review where needed without providing legal advice.
- [ ] Synthesize a concise contract matrix or equivalent covering all prior slices, MCP versus direct API recommendation and notice, happy-path impacts, blockers, and handoffs to location-input and bounded-crawl/recovery workstreams.
- [ ] For each material unknown, identify the downstream decision affected and next evidence action; give any proposed live probe its purpose, minimal scope, potential cost, data safeguards and separate approval gate. Recheck the full acceptance list.

#### Watch out
Do not imply project MIT licensing grants data rights; no publication, account changes or live collection. Do not resolve later workstreams' design decisions.

#### Verification
- `git diff --check`; review source URLs, access dates, evidence classifications and all brief acceptance topics in the final handoff.
- Run final verification above; report unresolved blockers and any unavailable validation.

#### Carry-forward
A durable sourced handoff and explicitly identified unresolved questions for Milestone 1's later workstreams.
