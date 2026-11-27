# Bright Data Discovery Workstream Brief

**Date**: 2026-11-27
**Status**: Draft — revised plan awaiting operator approval

## Why
Connect the existing bounded crawler to operator-funded discovery with a smaller, honest first-release path. This draft proposes changes to the previously approved plan; it does not replace that approval until the operator approves it.

## Happy path and acceptance boundary
- One operator supplies their own key, a confirmed coordinate, keyword, country, radius or bounding box, and independent cell, submission and active-time limits. Synthetic tests exercise one-seed discovery, SQLite persistence and cardinal expansion.
- Direct HTTP submits and observes bounded work; known IDs are saved and uncertain sends are never blindly retried. Stops, failures and incomplete observations remain visible, not empty successes.
- Results are conservative candidates, not verified identities; centers are bounded, returned places are not guaranteed inside the area, and coverage is not exhaustive.
- No geocoding, detail collection, enrichment, remote cancellation or guarantee that every paused observation automatically resumes.

## Key decisions
- Use direct HTTP and the existing traversal and SQLite core — avoid a general provider framework and disclose direct API use; MCP is optional.
- Use simple bounded waits and preserve known IDs — avoid indefinite polling and duplicate paid submissions.
- Stop and show unresolved work when recovery is unsupported — the operator retains the checkpoint and ID, checks provider status separately if authorized, and does not resubmit an uncertain send.
- Obtain applicable current provider, account-pricing and data-rights evidence separately from explicit operator approval before any paid call — the one successful probe establishes none of these guarantees.
- Protect BYOK credentials and real data — no secrets or raw provider data in shared artifacts, fixtures or logs.

## Open questions
- Does the operator approve this smaller plan and its explicit recovery and consent trade-offs in place of the earlier approved contract?
- Are applicable current provider behavior, account pricing and rights sufficiently evidenced for the intended actual use? Until then affected live use is blocked.

## Final smoke checks
- A bounded live demonstration is separately authorized, not included in this draft or the default checks.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
