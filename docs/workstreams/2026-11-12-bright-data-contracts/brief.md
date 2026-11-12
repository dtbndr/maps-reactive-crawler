# Bright Data Contracts Workstream Brief

**Date**: 2026-11-12
**Status**: Planned

## Why
The first-release crawler depends on provider behavior that is not yet established. This first Milestone 1 workstream will produce a current, source-backed contract handoff for later design and integration work.

## Happy path and acceptance boundary
- Document location discovery inputs and outputs, whether detail collection is necessary, and MCP versus direct API responsibilities, with evidence and unresolved blockers.
- Document snapshot lifecycle, failure and partial-result handling, limits, pagination, pricing, duplicate-paid-request risks, and applicable terms, attribution and data rights.
- Save durable findings under `docs/research/`, distinguishing documented facts, inference and unknowns; identify impacts on the bounded reactive happy path.
- Boundary: research only; no integration, live collection, paid calls, account changes or publication. Propose any necessary live probes for separate approval.

## Key decisions
- Use current primary provider sources and update the existing research handoff — catalog descriptions alone are not a tested runtime contract.
- Compare MCP and direct API without requiring an agent in the crawler runtime — deterministic scheduling remains project-owned.
- Treat undocumented behavior as a blocker or qualified unknown — assumptions about empty results, coverage or billing can be unsafe.
- Leave geocoding and geometry/recovery decisions to their later workstreams — this workstream supplies provider evidence and risks.

## Open questions
- None for planning; provider unknowns and any proposed probes will be surfaced in the research handoff.

## Final smoke checks
- None.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
