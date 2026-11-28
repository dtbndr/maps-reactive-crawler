# Location Input and Live Acceptance Workstream Log

## 2026-11-28 — planning
- Owner supplied the independent-operator model, explicit selection/confirmation and public-policy safeguards, synthetic recovery acceptance, deferred Geoapify (#11), and live-demo-or-blocker milestone. Oracle signed off to draft, not implement. See [location research](../../research/location-input-contract.md) for the superseding owner decision and source links; older contradictory recommendations there are historical.
- Applied the first-release P0/P1 filter: unsafe location selection, recovery, bounded work, provider policy and rights are in scope; #7–#10 are not default scope. This sequencing does not waive acceptance or required checks.
- The design choices, rejected alternatives, assumptions and reopening conditions are in [slices.md](slices.md). Current policy, service compatibility and storage rights require rechecking; no aggregate compliance, service availability or live correctness is claimed.
- Owner opted into design playback and independent external review; both were completed. Approval is separate from implementation and from any live/paid, account or publication authorization.
- No provider calls or implementation were performed in drafting this folder.

## 2026-11-28 — external review disposition
- DB-1 accepted: standalone confirmed resolution, exact coordinate handoff, operator-prepared full-invocation evidence and existing coordinate preview; connected tests must not conceal evidence mismatch.
- DB-2 accepted: fixture coordinate starts remain non-interactive as an explicit exception; the single Bright Data preview confirms seed and action, independently of candidate selection.
- IC-1 accepted: request structured country details and normalize alpha-2 casing without changing country identity. IC-2 accepted: fail-closed stale-lock and clock-regression handling with documented recovery, limited to the shared local cache. ADV-1 accepted: issue descriptions added.
- These revisions do not approve implementation or live/paid calls, secrets, account changes or publication; existing milestone and approval gates remain.

## 2026-11-28 — brief approval
- The owner approved [brief.md](brief.md) after the internal review passed and the verified external confirmation report found no remaining findings. Implementation and live activity remain separately authorized.

Isolation: branch — branch ws/location-input-live-acceptance

Pre-flight: findings — split B and clarified resolver attribution and confirmation-test ownership; resolved in slices.md

Smoke: skipped (agent-verified) — documented blocker alternative; no live demo.

P2/P3: deferred findings (6):

- Slice A: P2: injected unavailable-selection test uses ambiguous /cancel/i assertion; verify selector reached and location-specific cancellation.
- Slice B: P2: numeric coercion accepts non-decimal coordinate strings such as 0x30.
- Slice B1 interim: P2: busy timeout conflates healthy contention with abandoned ownership; distinguish retry-later and add slow-owner coverage.
- Slice B1 interim: P2: tighten assembled monotonic restart, crash recovery and regression evidence.
- Slice C: P2: mismatch test uses generic diagnostic rather than specific evidence-blocked outcome.
- Final: P3: archived Slice B1 test-output transcript contains trailing whitespace.

RED gaps: historical test-first evidence limitations (3; not production-defect findings):

- Slice A: RED gap: standalone location individual candidate, cancellation, attribution, error and handoff contracts — rung 2 tried: isolated base 07837ab with committed tests and compiling sentinel, mise exec -- node --test test/location-input.test.mjs → combined assertions mask contracts and one cancellation test passes generic usage — why it fails: entangled test edits and cannot isolate — worker-attested: initial stub RED used generic errors; GREEN at 8140204
- Slice B: RED gap: endpoint switching, request fields, attribution, structured country and error variants — rung 2 tried: detached 4ac62ca, restored implementation to compiling stub, mise exec -- node --test test/nominatim-search.test.mjs → grouped assertions masked later cases and country test TypeError — why it fails: cannot isolate entangled test assertions — worker-attested: grouped pre-edit RED, no individual failures — GREEN at 4ac62ca
- Slice B1: RED gap: individual guarded assembly timeout, crash, clock, lifecycle and CLI contract assertions — rung 2 tried: detached 61c2d60 restoring a1f14d4 implementation with compiling pass-through stubs; mise exec -- node --test --test-timeout=12000 per focused test file → masked assertions, errors and timeouts alongside some assertion failures — why it fails: cannot isolate entangled tests — worker-attested: generic Not implemented and post-implementation tests are not historical RED — GREEN at 61c2d60

Final review: clean (at 26dac3f)
