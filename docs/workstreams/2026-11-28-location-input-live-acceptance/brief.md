# Location Input and Live Acceptance Workstream Brief

**Date**: 2026-11-28
**Status**: Planned

## Why
An operator needs to turn an intentional location into a bounded crawl without guessing or accidentally paying for provider work. This plan connects location selection to synthetic acceptance and preserves the milestone's possible live demonstration or documented blockers.

## Happy path and acceptance boundary
- Resolve text in a standalone step: require country, show candidates and country context, and explicitly confirm the chosen result even if only one. Output exact round-trip-precision coordinates and country context; then the operator prepares evidence for the full invocation and runs the existing coordinate start without re-geocoding or rounding.
- Fixture coordinate starts remain non-interactive, an explicit exception to post-preview confirmation. Bright Data coordinate starts display seed and country, with the existing single affirmative preview confirming both seed and action before credentials, checkpoint or dispatch; candidate confirmation is separate.
- Connected synthetic acceptance proves the selected seed reaches the bounded crawler, fresh-process resume uses the stored seed without geocoding or duplicate dispatch of previously submitted work, and stops and coverage limitations are visible.
- Milestone outcome: a separately approved bounded live demo **or** documented blockers. Synthetic evidence does not establish live identity, details, completeness or coverage.
- Boundary: this brief authorizes planning only; approval of it does not authorize implementation, secrets, live or paid calls, publication or account actions.

## Key decisions
- Independent operators select a Nominatim Search-compatible service, explicitly selecting the public endpoint if desired — no shared default, project aggregate coordination or service SLA is promised.
- Require identification, attribution, persistent scoped caching, serialized requests at least 1.1 seconds apart including retries, and no autocomplete — public service policy applies and operators remain responsible; local safeguards cannot guarantee aggregate compliance.
- Retain Bright Data preview and affirmative dispatch gate — geocoding confirmation is not consent to paid discovery.
- Minimize retained data and exclude raw candidates from checkpoints and exports absent rights evidence — provider data rights are not established.
- Defer Geoapify to issue #11; do not include #7 (v2 export optional-format typing), #8 (operator/v2 import cycle), #9 (synthetic v2 export milestone dependency), or #10 (owner-liveness status projection coverage) by default — keep first-release P0/P1 work focused.

## Open questions
- What endpoint, identification and applicable service terms will each operator use? Does current evidence permit the intended retained fields and any export?
- Before a live demo, do #4 (unsupported Retry-After visibility), #5 (back-to-back running-snapshot polling), provider contracts, data rights, pricing and bounded cost/work limits permit it? Otherwise document the blocker.

## Final smoke checks
- Only after separate authorization, run a bounded live demo after providing a pre-spend estimate (including inability to bound cost) and obtaining approval of uncertain cost and work/stop limits; record actual cost and limitations in the milestone, or document why it is blocked; reassess #4 (unsupported Retry-After visibility), #5 (back-to-back running-snapshot polling), and current contracts, rights and pricing first.

## Pointers
- Slices (agents only): [slices.md](slices.md)
- Log (agents only): [log.md](log.md)
