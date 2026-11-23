# Bounded Reactive Core Workstream Log

Opt-ins: playback=off, external review=on
Isolation: branch — branch ws/bounded-reactive-core
Pre-flight: clean

## Geometry contract revision — supersedes Slice A numerical decision

Operator-approved direction replaces rigorous enclosure/exact-decimal semantics with practical finite JavaScript Number behavior. The recovery handoff and Slice A geometry tasks now specify a seed-anchored metre grid, inclusive bbox comparison on actual coordinates, spherical haversine distance ≤ radius, ordinary-arithmetic invalid/pole/seam preflight, and validated seed eligibility. No arbitrary epsilon/buffer or coordinate rounding after check. Reliable candidates are classified; unreliable candidates remain unverified. No strict containment or exhaustive-coverage claims.

This supersedes the earlier requirement to derive floating-point error bounds, fail closed on boundary-straddling intervals, and test synthetic indeterminate comparisons. Those requirements are removed from Slice A acceptance. Slice A remains blocked pending implementation/tests of the revised practical edge, high-latitude, small-area and traversal behavior. Accounting, uncertainty/recovery, caps and time-safety decisions are unchanged. Documentation-only revision; no implementation performed.
