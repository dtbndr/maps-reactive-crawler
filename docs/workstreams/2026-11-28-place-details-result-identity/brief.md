# Place Details and Result Identity Workstream Brief

**Date**: 2026-11-28
**Status**: Planned

## Why
The v1 export omits mapped names even though current direct-provider paths pass names through traversal into durable observations. Pending detail work is not executed. This work makes useful records and the limits of identity, coverage and detail state explicit without assuming a provider details contract.

## Happy path and acceptance boundary
- Synthetic reopen/resume and partial-outcome tests retain each occurrence, available observations and provenance; only explicitly verified fixture identity groups records.
- Explicit v2 export reports available observation fields and status while preserving inherited discovery/detail gap semantics; unchanged v1 remains the default and old checkpoints remain inspectable.
- Boundary: no detail collection, provider/schema/rights assumptions, live demonstration, paid calls, account changes or publication. No completeness or live identity claim.

## Key decisions
- Preserve v1 export as the no-option default; select v2 explicitly — avoids a silent output-shape break.
- Treat `place_id` as an unverified candidate identifier unless fixture identity is explicitly verified — provider identity is unestablished.
- Do not infer missing provider fields or failure from pending/not-attempted details — no detail response was collected.
- Keep every occurrence and provenance; group only verified fixture identity — names, coordinates and candidate IDs are not identity proof.
- Preserve current status projection, including possible overlap between `discoveryGaps` and detail-origin blockers in `detailGaps` — do not silently redefine inherited status.
- Defer provider detail execution — current URL-input catalog evidence and persisted data do not establish a runnable request/response contract.

## Open questions
- none; approve this brief before implementation.

## Final smoke checks
- None

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
