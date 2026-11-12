# Location Input Contract Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Produce a current, evidence-backed geocoder evaluation and location-input contract for the first-release happy path, or identify explicit blockers to a recommendation.

## Scope
**In scope**
- Establish intended-use assumptions, eligibility criteria and plausible candidates; research authoritative public documentation and compare candidates.
- Specify coordinate input validation and operator confirmation, and evidence-dependent human-readable location resolution, ambiguity, country and attribution handling.
- Record sources, unknowns, conflicts and downstream decisions in a durable research handoff.

**Out of scope**
- Integration, implementation tests, live provider calls or probes, paid calls, account changes, publication, credentials and real customer data.
- Radius, bounding-box, grid, filtering, retry or recovery decisions; these belong to the later bounded-crawl workstream.

## Key files
- `docs/research/location-input-contract.md`: new durable criteria, comparison and contract handoff.
- `docs/happy-path.md`, `docs/milestones/01-contracts-and-boundaries.md`, `docs/research/bright-data-mcp.md` and `docs/research/legacy-reactive-crawl.md`: read-only context, provider-required country evidence and legacy Nominatim reference, not assumed geocoder guarantees.
- `docs/workstreams/2026-11-12-location-input-contract/`: planning artifacts and execution log.

## Architecture invariant
One operator-provided coordinate or confirmed location seeds the project-owned crawler. Never silently choose among ambiguous locations or default country to the US. Location resolution does not decide crawl geometry. No recommendation may depend on exceeding applicable rate limits, paying for intended use or undocumented provider permission. Public research does not authorize calls or external side effects.

## Assumptions and design decisions
- **Evidence first:** Compare plausible candidates before recommending one; reject selection by familiarity. Use current primary provider policy, pricing and API documentation with exact URLs, section, access date and effective/version date when available. Separate documented facts, inference and unknowns; resolve conflicts or report them. Reopen for changed sources or intended use.
- **Free and compliant:** A provider qualifies only where evidence supports free use for the stated operator-run first-release workload and policy compliance. Examine free-tier quotas, overage and billing requirements separately from usage policy and rate limits, including aggregate application/IP traffic versus per-user throttling. An unbounded or unspecified workload cannot establish eligibility: state realistic assumptions and operator responsibilities, and block if they cannot be supported. Reject paid fallback or relaxing limits; reopen when scope or evidence changes with operator approval.
- **Explicit input:** Define valid latitude/longitude ranges, invalid input rejection, displayed resolved coordinate and operator confirmation; document whether direct coordinates bypass resolution and what confirmation means. For text, preserve ambiguity and no-result/error outcomes rather than guessing; determine country requirements from authoritative evidence, never assume US. Do not invent a provider response or exact CLI syntax. Reopen evidence-dependent behavior when provider details are verified.
- **Rights and safety:** Assess authentication, attribution, storage and permitted use, and data rights separately from project MIT licensing; flag jurisdiction/account-specific questions without legal conclusions. No live calls, even free ones. Any proposed probe requires separate approval with purpose, minimal inputs, potential costs, rate and data safeguards.
- **Sequencing:** Keep evaluation and contract separate from crawl-boundary design and implementation. Reject combining workstreams because unverified provider constraints would contaminate geometry decisions.

### Implementation discretion
- Research organization, candidate discovery and synthetic examples, subject to the evidence and scope requirements.
- Exact presentation and paths for supplementary research, if needed, linked from the handoff; each slice touches 1–5 files.

### Unresolved design blockers
None for planning. Missing evidence, workload assumptions or lack of a qualifying provider are research outputs and may block the downstream contract or provider choice; do not fabricate decisions.

## Final verification
Run from the repository root:
- [ ] `git diff --check` passes; inspect untracked research files for whitespace too.
- [ ] Run `mise install`, `mise exec -- npm ci`, then `mise exec -- npm run check`; record unavailable checks and reasons. The project check covers typecheck, tests and build; no separate lint or formatter scripts are defined.
- [ ] Offline review each acceptance topic, candidate eligibility, source URL and date, evidence label, contradiction, unresolved blocker and downstream handoff. Ensure no unsupported provider claims, secrets or real customer data.
- [ ] Record evidence-review failures and resolutions; do not claim implementation tests or live validation. Execution may commit verified slices only under its separately authorized workflow.

---

## Slices

### Slice A: Criteria and candidates

**Goal**: Establish a reproducible comparison and plausible candidates without selecting a provider.

#### Tasks

**`docs/research/location-input-contract.md`**
- [ ] Before research, list missing acceptance evidence as the documentation-only red check: intended operator-run use and workload assumptions, free eligibility, applicable policy, quotas and rate-limit scope, authentication, ambiguity, country, attribution, storage and rights.
- [ ] Define criteria and a candidate inclusion rationale; identify multiple plausible providers without asserting eligibility. Make workload, traffic aggregation and unknown operator behavior explicit; identify assumptions requiring owner confirmation.
- [ ] Establish an evidence ledger with authoritative source locations, access dates and documented-fact/inference/unknown labels. Note inaccessible sources and conflicts.
- [ ] Recheck the criteria and candidate inventory against the initial gaps; leave missing evidence as explicit work for Slice B.

#### Watch out
A free tier is not proof that the intended application is allowed or that its aggregate traffic is within limits. No provider calls or account creation.

#### Verification
- `git diff --check`; inspect the new handoff, including untracked whitespace, for all criteria, assumptions, candidates and unresolved evidence gaps.

#### Carry-forward
Candidate list, workload assumptions and evidence checklist for comparison.

### Slice B: Research and compare

**Goal**: Evaluate candidates against the established criteria using current authoritative sources.

#### Tasks

**`docs/research/location-input-contract.md`**
- [ ] Before research, mark each candidate/criterion lacking evidence as a failing evidence check.
- [ ] Consult current provider API, usage policy, terms and pricing sources. Compare intended-use permission, free-tier limits and overages, billing/auth requirements, per-user versus aggregate/IP/application throttling, ambiguity and country capabilities, attribution, storage and data rights. Assess persistence of confirmed coordinates, resolved labels, provenance and country in local checkpoints and exported run metadata. Capture exact qualifiers, dates and conflicting sources.
- [ ] Classify each candidate as supported, disqualified or unresolved against each criterion; distinguish documentation silence from prohibition. State how any rate controls could comply under the explicit workload assumptions without designing an integration.
- [ ] Recheck every initial gap; attach evidence or an explicit blocker and next evidence action. Do not infer qualification from missing prices or limits.

#### Watch out
Do not extrapolate an account-specific entitlement or free allowance. Terms may change; direct authoritative evidence is not runtime testing. No live provider calls.

#### Verification
- `git diff --check`; review the comparison for cited and dated claims, per-scope rate limits, free eligibility, terms, ambiguity, country and unresolved evidence.

#### Carry-forward
Evidence-backed candidate comparison and blockers for contract synthesis.

### Slice C: Recommendation and input contract

**Goal**: Deliver a usable location-input handoff and a qualified recommendation, or an explicit blocker.

#### Tasks

**`docs/research/location-input-contract.md`**
- [ ] Before synthesis, list missing evidence for recommendation and direct-coordinate and text-input behavior as the failing acceptance check.
- [ ] Recommend only a candidate whose intended-use, free-cost and rate-limit eligibility is supported; specify conditions, evidence and alternatives. If none qualifies or required assumptions remain unsupported, state the blocker and next action rather than relaxing constraints.
- [ ] Document coordinate input ranges, malformed and non-finite rejection, order, display and explicit operator confirmation; direct coordinates bypass geocoding. For text inputs, specify candidate presentation and confirmation, ambiguity, no result and errors. Specify how provider-required country is supplied and validated for both paths, including text-query country filter or bias versus resolved candidate country and mismatch handling; derive requirements and attribution from evidence or mark them unresolved. Never silently pick a result or default country to US.
- [ ] Identify impact on downstream integration and bounded-crawl work, remaining decisions and evidence actions. Propose any useful live probe only for separate approval, with scope, potential cost, limits and data safeguards. Recheck every acceptance gap.

#### Watch out
A documented contract is not a tested integration. Avoid prescribing boundary semantics, unsupported response shapes or provider-specific guarantees; no publication or external account changes.

#### Verification
- `git diff --check`; review all source links, dates, evidence labels, input outcomes, eligibility conditions and blockers.
- Run final verification above and report unavailable checks and residual risks.

#### Carry-forward
A sourced location-input contract, conditional provider recommendation or blocker, and explicit handoff to later Milestone 1 and integration work.
