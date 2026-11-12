# Location Input Contract Workstream Brief

**Date**: 2026-11-12
**Status**: Done

## Why
The first-release happy path needs a reliable starting coordinate, but the location provider and input contract are not established. This workstream evaluates current evidence before a provider or contract is chosen.

## Happy path and acceptance boundary
- Compare plausible geocoders against documented use, cost, limits, authentication, ambiguity, country, attribution and data rights; recommend a qualifying provider or report blockers.
- Document coordinate input validation and confirmation, and location resolution and operator confirmation without silent guessing or a US default; mark evidence-dependent details unresolved.
- Boundary: documentation research only; no integration, live provider calls, paid calls, account changes, publication or crawl-boundary design.

## Key decisions
- Require free use for the intended operator-run application and compliance with applicable rate limits — a paid or noncompliant fallback is not acceptable.
- Evaluate current authoritative sources before recommending a provider — choosing without comparison risks an unusable contract.
- Separate location input from crawl-boundary decisions — the latter belongs to a subsequent workstream.

## Open questions
- None for planning; provider eligibility, usage assumptions and contract unknowns are research outputs or blockers.

## Final smoke checks
- None.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
