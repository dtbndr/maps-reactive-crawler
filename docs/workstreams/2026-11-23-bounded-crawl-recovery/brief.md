# Bounded Crawl Recovery Workstream Brief

**Date**: 2026-11-23
**Status**: Approved

## Why
Milestone 1 needs an evidence-backed contract for bounded discovery and safe recovery before an offline implementation can be planned.

## Happy path and acceptance boundary
- Produce a decision-complete research handoff with synthetic scenarios and clearly separated provider unknowns.
- Describe bounded connected discovery, independent limits, coverage gaps and recovery for one operator.
- Boundary: no implementation, live calls, publishing, account changes or geocoder selection.

## Key decisions
- Operator chooses grid spacing and independent paid submission, cell and active-time caps — bound work without claiming a monetary cost guarantee.
- Active time includes waits and backoff but excludes deliberate pause and downtime; explicit cap increases retain totals — prevent budget resets.
- Classify reliable coordinates inside or outside; keep unverified separate — avoid unsupported coverage claims.
- Reject antimeridian-crossing and pole-containing areas in the initial offline slice — avoid ambiguous geometry.
- Expand cardinally only after successful nonempty raw discovery — failures cannot manufacture coverage.
- Isolated exhausted failures become gaps while other work continues; global failures pause — preserve safe progress.
- Operator sets finite retries for known safe transient failures; paid resubmissions and detail requests count — bound submission attempts.
- Uncertain paid sends pause; recover known identifiers when possible, require approval to resend, or skip with a gap and conservative accounting — avoid silent duplicate charges.

## Open questions
- Which provider-specific failure, submission, identifier recovery and billing guarantees can be verified without paid calls? Mark any unresolved as integration blockers, not invented contracts.

## Final smoke checks
- None

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
