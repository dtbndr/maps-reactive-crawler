# Durable Recovery and Result Identity Workstream Brief

**Date**: 2026-11-24
**Status**: Planned

## Why
Make the bounded offline traversal restartable without silently losing observations, exceeding independent budgets, or hiding uncertainty and gaps.

## Happy path and acceptance boundary
- Synthetic, on-disk SQLite and fresh-process restart tests cover discovery, interruption, known-ID observation, fan-out, limits, cancellation and partial outcomes.
- Verified synthetic place identities deduplicate while retaining observations and provenance; unverified observations remain separate, and cell and detail gaps remain distinct.
- Restart never blindly resends an uncertain intent; durable counters, retry allowances and time accounting remain conservative.
- Boundary: no CLI/export, fuzzy matching, real provider or geocoder, paid calls, publication or account changes; no provider or exhaustive-coverage guarantees.

## Key decisions
- Combine durability and minimum verified identity in sequential gates — result application, provenance and gap reconciliation share recovery boundaries.
- Rescope after restartable discovery if the work is too large — retain replay keys and raw provenance rather than splitting at a schema alone.
- An intent without a durable ID is uncertain on restart — an unsent reservation can conservatively consume a submission slot.
- Fixture-declared verified canonical identity only — real-provider identity is not established.

## Open questions
- None.

## Final smoke checks
- None.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
