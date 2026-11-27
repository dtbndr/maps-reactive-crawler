# Bright Data Discovery Workstream Brief

**Date**: 2026-11-27
**Status**: Planned

## Why
Connect the bounded crawler to operator-funded discovery without hiding uncertain paid work or claiming unverified provider behavior.

## Happy path and acceptance boundary
- An individual operator supplies a confirmed coordinate, keyword, country, explicit bounds and independent cell, submission and active-time limits; credential-free synthetic tests exercise connected discovery and expansion.
- Known IDs are durably observed; uncertain submissions remain visible and are never blindly repeated. Empty, failed, partial and capped outcomes remain distinct.
- Missing method-specific contract evidence blocks the affected provider behavior; a documented blocker is not a live demonstration.
- Place details, verified identity, geocoding and live acceptance are outside scope. Cell-center bounds do not guarantee returned-place containment or exhaustive coverage.

## Key decisions
- Prefer project-controlled direct HTTP over the SDK — lifecycle and retry control must be explicit and evidence-backed.
- Keep provider execution contract-gated — generic async documentation does not establish the Maps-specific async operation.
- Persist dispatch, reservations and IDs before dependent actions — recovery must not create duplicate paid work.
- Bound observation independently and retain gaps — local stop or cancellation does not establish remote cancellation.
- Use each operator's `BRIGHT_DATA_API_KEY` without persisting or logging it — credentials remain operator-owned; MCP is optional, not runtime infrastructure.
- Require separate approval and an uncertain cost estimate and stop limits before live work — submission limits alone do not bound spend.

## Open questions
- Is the current Maps-specific async request, acknowledgment, result and recovery contract authoritative enough for safe use? Until verified, the affected route remains blocked.

## Final smoke checks
- None; a live provider demonstration is a separate, explicitly approval-gated workstream outcome.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
