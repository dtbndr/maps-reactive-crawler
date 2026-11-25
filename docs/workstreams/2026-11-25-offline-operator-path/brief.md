# Offline Operator Path Workstream Brief

**Date**: 2026-11-25
**Status**: Planned

## Why
Connect the tested offline traversal and durable recovery into a reproducible operator path without implying live-provider readiness.

## Happy path and acceptance boundary
- A synthetic coordinate crawl displays validated geography and finite limits before collection, stops with admitted neighbors at a submission cap, and resumes in a fresh process after an explicit cap increase without replay.
- Status and versioned export preserve provenance, verified-only identity deduplication, unverified observations, frontier disposition, simultaneous limits, pending details and distinct gaps; cancellation and partial failures remain visible.
- Cell-center eligibility is not a returned-place filter; connected expansion can miss areas and provider results may be incomplete. Discovery exhaustion is not exhaustive coverage or completed detail.
- Boundary: synthetic discovery only; no detail scheduling, live provider, location resolution, paid calls, publication or account changes.

## Key decisions
- Thin shared library and CLI — one operator contract avoids divergent execution paths.
- Atomically bind fixture identity to each checkpoint — restart cannot silently switch synthetic evidence.
- Read-only consistent status and export — inspection must not acquire a writer lease or modify recovery state.
- Serial durable execution and cooperative cancellation — preserve existing recovery and accounting without promising interruption of synchronous callbacks.
- Report blocked frontier and all concurrent conditions independently — a cap edit does not promote blocked cells and a headline alone can mislead.

## Open questions
- None.

## Final smoke checks
- None.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
