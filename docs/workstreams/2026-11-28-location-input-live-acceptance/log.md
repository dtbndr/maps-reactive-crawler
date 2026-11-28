# Location Input and Live Acceptance Workstream Log

## 2026-11-28 — planning
- Owner supplied the independent-operator model, explicit selection/confirmation and public-policy safeguards, synthetic recovery acceptance, deferred Geoapify (#11), and live-demo-or-blocker milestone. Oracle signed off to draft, not implement. See [location research](../../research/location-input-contract.md) for the superseding owner decision and source links; older contradictory recommendations there are historical.
- Applied the first-release P0/P1 filter: unsafe location selection, recovery, bounded work, provider policy and rights are in scope; #7–#10 are not default scope. This sequencing does not waive acceptance or required checks.
- The design choices, rejected alternatives, assumptions and reopening conditions are in [slices.md](slices.md). Current policy, service compatibility and storage rights require rechecking; no aggregate compliance, service availability or live correctness is claimed.
- Optional design playback and independent external review may be requested before approval; neither is implied by this draft. Approval is separate from implementation and from any live/paid, account or publication authorization.
- No provider calls or implementation were performed in drafting this folder.

## 2026-11-28 — external review disposition
- DB-1 accepted: standalone confirmed resolution, exact coordinate handoff, operator-prepared full-invocation evidence and existing coordinate preview; connected tests must not conceal evidence mismatch.
- DB-2 accepted: fixture coordinate starts remain non-interactive as an explicit exception; the single Bright Data preview confirms seed and action, independently of candidate selection.
- IC-1 accepted: request structured country details and normalize alpha-2 casing without changing country identity. IC-2 accepted: fail-closed stale-lock and clock-regression handling with documented recovery, limited to the shared local cache. ADV-1 accepted: issue descriptions added.
- These revisions do not approve implementation or live/paid calls, secrets, account changes or publication; existing milestone and approval gates remain.
