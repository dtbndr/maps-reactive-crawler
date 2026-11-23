# Bounded crawl: geometry, traversal, and budgets

**Slice A research handoff — 2026-11-23.** This is an offline design contract, not implemented or runtime-validated behavior. Scenarios below are synthetic. No provider calls, paid activity, account changes, or geocoder selection occurred. Provider billing, response and rights details remain subject to the unknowns in [Bright Data research](bright-data-mcp.md).

## Evidence and boundary

The [happy path](../happy-path.md) calls for one seed cell, raw-nonempty cardinal expansion, deduplication, explicit area/work bounds, and honest stop reasons; boundary semantics and exact flags are explicitly unspecified there. It requires a confirmed coordinate or displayed-and-confirmed resolved location, keyword, and country as required by a verified provider. The [location-input contract](location-input-contract.md) requires explicit country for place-name lookup, candidate confirmation, and no silent country default or geocoder selection. The [Milestone 1 contract](../milestones/01-contracts-and-boundaries.md) requires deciding center versus returned-place filtering. The [roadmap](../roadmap.md) makes the offline reactive slice precede provider integration; [SDLC priorities](../sdlc-priorities.md) focus on evidence-backed first-release safety. The [legacy handoff](legacy-reactive-crawl.md) documents disconnected legacy reactive code, not validated target behavior. Bright Data's surveyed catalog documents required country/keyword for location discovery and URL discovery output, while method semantics, completeness and billing remain unresolved; see [provider research](bright-data-mcp.md). These sources support a conservative offline contract, not provider guarantees.

## Input, geometry and traversal contract

Accept exactly one operator-confirmed seed (coordinate or resolved location), a nonempty keyword, country context when required by the verified provider, and exactly one explicit finite positive radius or valid bounding box, plus finite positive grid spacing and independent work caps. Reject malformed/non-finite coordinates, invalid ranges, inverted/degenerate bounds, and antimeridian-crossing or pole-containing regions in this initial slice. Text resolution must be displayed and confirmed upstream; this document selects no geocoder. Country is not silently inferred/defaulted.

Use a deterministic grid anchored to the bounded region and spacing, with canonical integer row/column identity (not floating coordinate equality). A cell center is eligible for queueing iff it lies within the requested area, **including boundary edges**. Radius membership uses center distance to the seed at or below the requested radius; bounding-box edges are inclusive. This center rule is about scheduling only, not containment of every part of a cell or returned place.

Persist cell identity before submission and enforce uniqueness on that identity. Duplicate neighbor discoveries do not enqueue or submit another cell. Begin with one eligible seed cell. After successful discovery with at least one raw candidate, enqueue eligible cardinal N/S/E/W neighbors only. Expansion uses raw discovery count before candidate filtering/deduplication; a duplicate-only nonempty response still permits expansion. Empty success does not expand; failure, unrecognized or uncertain response does not expand. No diagonal expansion.

For candidates with reliable coordinates, classify as inside or outside the requested area using the same inclusive radius/bounds edge rule; retain both with classification/provenance rather than silently discard outside results. Missing/unreliable coordinates are unverified, never treated as inside or outside; retain separately. Cell-center eligibility, place classification, and output retention are distinct. Coverage remains heuristic: provider omissions/caps, disconnected areas, grid spacing and stopping limits can leave gaps; connected traversal does not establish exhaustive coverage or strict place containment.

## Independent limits and durable accounting

| Limit | Unit and enforcement | Cumulative rule |
|---|---|---|
| Submission cap | Count each potentially billable provider submission at durable intent/dispatch boundary: discovery, detail, retry/resubmission, failed, empty, and uncertain sends all count. Never submit if next attempt exceeds cap. | Durable monotonically increasing session total; do not decrement on failure or restart. An uncertain send is charged conservatively. |
| Cell cap | Unique eligible cell identities admitted for processing; check before adding a new cell to queue. | Cumulative unique cells for the crawl, including seed; duplicates do not count twice. |
| Active-time cap | Monotonic elapsed active duration; check before starting a new submission/retry and before admitting more work. | Persist accumulated active duration across sessions; never reset on cap increase. |

Active duration includes provider waits, polling, and retry backoff while the crawl is active; excludes deliberate operator pause and process downtime. Within a process use a monotonic clock, not wall-clock timestamps. Checkpoint elapsed deltas and pause/resume transitions durably; on crash, preserve last durable total and conservatively account any uncertain interval since that checkpoint (at minimum do not claim it was zero). A cap increase changes only the configured ceiling; all prior totals remain. Decreases also do not erase totals.

Reaching any cap prevents new submissions and retries. It does **not** cancel, interrupt polling, or abandon backoff/wait for already-submitted work: continue observing accepted work and account active time until its result is obtained or the operator cancels. Cancellation is a separate stop request; no claim is made that it cancels provider work or avoids billing. Attempt limits bound submissions, not returned/billed record count or monetary spend. Available pricing evidence is not sufficient to calculate a monetary bound; leave spend unresolved pending applicable pricing evidence.

## Synthetic traces and outcome vocabulary

All trace values are synthetic, not provider evidence. State is reported distinctly as: `complete` (queue exhausted, no unresolved gaps), `partial_empty_success` (successful empty response; no expansion), `partial_failed` (explicit failure; not empty), `partial_unrecognized` (cannot classify response; not empty), `partial_limit` (a cap prevented work), `partial_cancelled`, or `partial_gaps` (queue exhausted while unresolved gaps remain). Report cell outcomes, raw candidate count, retained inside/outside/unverified candidates, remaining queue, exhausted gaps, counters and stop reason. Queue exhaustion with unresolved gaps is never `complete`.

1. **Inclusive edge:** bbox [0,0,2,2], spacing 1; center at east edge x=2 admitted and a place exactly on edge classified inside; center beyond rejected; reliable place beyond retained as outside. Outcome depends on remaining queue/gaps, not merely edge filtering.
2. **Empty vs nonempty:** seed returns successful raw `[]` → `partial_empty_success`, no neighbors. A successful raw `[A]` → admit eligible cardinal neighbors, even if later filtering retains no candidate.
3. **Duplicate:** seed raw `[A]`, four eligible neighbors; same cell discovered twice → one queued/submitted cell by row/column identity. If neighbor later returns duplicate A, retain one canonical place record while preserving source-cell provenance; raw-nonempty still allows expansion.
4. **Unverified:** raw candidate U lacks trustworthy coordinates → retain in unverified set, not inside/outside; raw nonempty permits expansion.
5. **Rejected geometry:** antimeridian-crossing bbox or area containing a pole → reject before seed submission; no provider work/counters consumed.
6. **Submission cap:** cap=2; seed discovery and one detail request consume 2. Next discovery/retry denied; status `partial_limit`; existing submitted work may still be polled.
7. **Cell cap:** cap=2; seed and one unique neighbor admitted. Further unique neighbors denied, duplicates remain no-ops; `partial_limit` with queue/blocked work reported.
8. **Active-time cap:** cap=10 units; active work plus polling/backoff reaches 10. No further submission/retry; already-submitted result may continue to be polled, so final active duration can exceed limit and this is reported. Operator pause/downtime does not add active time; resume retains total.
9. **Failure/unrecognized/cancellation:** failed or unrecognized seed response yields respective partial state and no expansion, unlike empty success. Cancellation yields `partial_cancelled`; already-submitted work uncertainty is reported. If queue empties but unresolved gaps exist, `partial_gaps` takes precedence over complete.

### Slice A verification record

Documentation-only acceptance: trace outcomes and independent accounting rules reviewed against Slice A tasks; no behavior tests apply and no provider claim is made. Required project commands and exact results are recorded in the slice report/commit handoff.
