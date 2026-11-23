# Bounded Reactive Core Workstream Brief

**Date**: 2026-11-23
**Status**: Planned

## Why
Establish a reproducible offline traversal core before adding durable recovery or provider integrations.

## Happy path and acceptance boundary
- A confirmed coordinate and explicit geography seed deterministic cardinal traversal driven by synthetic results; raw nonempty results expand, empty and failed results do not.
- Independent cell, submission and active-time limits produce explicit partial outcomes; admitted work is not stranded by the cell cap.
- Cell eligibility and retained inside, outside and unverified candidate classifications are distinct; connected traversal is not exhaustive coverage.
- Recovery-ready transitions are exercised in memory only; SQLite, CLI, real provider, geocoder and live calls are excluded.

## Key decisions
- Pure deterministic transition core with a thin serial fixture driver — makes decisions reproducible and persistence-ready.
- Follow the bounded-crawl recovery handoff for geometry, accounting and outcomes — preserves the downstream recovery contract.
- Legacy reactive code is background, not a port — its loop is not validated production behavior.

## Open questions
- None.

## Final smoke checks
- None.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
