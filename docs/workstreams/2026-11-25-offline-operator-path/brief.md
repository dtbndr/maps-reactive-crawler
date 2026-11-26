# Offline Operator Path Workstream Brief

**Date**: 2026-11-25
**Status**: Draft — awaiting operator approval

## Why
Connect the tested offline traversal and durable recovery into a reproducible operator path without implying live-provider readiness.

## Happy path and acceptance boundary
- A synthetic coordinate crawl displays validated geography and finite limits before collection, stops with admitted neighbors at a submission cap, and resumes in a fresh process after an explicit cap increase without replay.
- Status and versioned export preserve provenance, verified-only identity deduplication, unverified observations, frontier disposition, simultaneous limits, pending details and distinct gaps; cancellation and partial failures remain visible.
- Cell-center eligibility is not a returned-place filter; connected expansion can miss areas and provider results may be incomplete. Discovery exhaustion is not exhaustive coverage or completed detail.
- Boundary: synthetic discovery only; no detail scheduling, live provider, location resolution, paid calls, publication or account changes.

## Key decisions
- Thin shared library and CLI — one operator contract avoids divergent execution paths.
- Start atomically stages a fully initialized, fixture-bound database and publishes with same-directory hard-link no-replace; an existing destination is rejected. Validate fixture identity on the same connection before application mutations. Preserve SQLite writer claims/transactions, conservative live-appearing PID refusal (including PID reuse), existing interrupted recovery and no-blind-resend behavior. Resume and cancel refuse such a claim before eligibility or cancellation, with nonzero exit, empty stdout and no application mutation; interrupted cancellation requires a successful claim and preserves recovery evidence. A recovery stop after a successful claim may exit 0.
- Idle read-only status and export — inspection uses a SQLite read-only snapshot and changes no application state; it may report a live-appearing owner as potentially interrupted and recovery pending. Commands are strictly sequential, with no concurrent command supported.
- One operator, one stable local checkpoint path, one command at a time — no concurrent commands, network/synced mounts, or active path moves. The local filesystem must support SQLite locking and same-directory hard-link no-replace publication; no separate coordination lock, native addon or runtime filesystem certification.
- Report blocked frontier and all concurrent conditions independently — a cap edit does not promote blocked cells and a headline alone can mislead.

## Sizing
A1 is complete; A2 and later slices are blocked pending approval of this revised brief. The remaining slices cover publication, binding and the operator contract, not concurrent access.

## Open questions
- None.

## Final smoke checks
- None.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
