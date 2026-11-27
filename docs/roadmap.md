# First-release roadmap

Status: **provisional; the synthetic offline operator workstream is complete; live integrations remain**. Use [SDLC priorities](sdlc-priorities.md) to keep work tied to the [happy path](happy-path.md). Milestone labels indicate order, not priority grade or authorization. A milestone may span multiple Solopowers workstreams; a workstream is a separately scoped execution unit.

## Milestones

1. [Verify external contracts and decide boundaries](milestones/01-contracts-and-boundaries.md)
2. [Offline reactive vertical slice](milestones/02-offline-reactive-slice.md)
3. [Provider and location integrations](milestones/03-provider-integrations.md)
4. [Release readiness](milestones/04-release-readiness.md)

## Current setup handoff

See the [legacy reactive-crawl research handoff](research/legacy-reactive-crawl.md) for source-checked legacy behavior, its disconnected batch/reactive paths, and first-release design cautions. The [Bright Data MCP research](research/bright-data-mcp.md) surveys agentic tools, Maps scraper discovery, and outstanding contract questions.

Milestone 1 research workstreams and the three Milestone 2 offline workstreams are complete. Durable offline state and recovery, including synthetic fixture-verified result identity, and the fixture-backed operator CLI/status/export path are implemented and tested with SQLite and fresh-process restart coverage. The guarded direct Bright Data discovery path is implemented and fixture-tested; live behavior is unvalidated, the geocoder is not implemented, and the complete end-to-end crawler remains unfinished. Tests establish offline synthetic behavior only—not real-provider identity, lookup, retry/idempotency, billing, cancellation, or exhaustive coverage. Legacy untagged blockers remain fail-closed. Milestone plans are not permission for paid calls.
