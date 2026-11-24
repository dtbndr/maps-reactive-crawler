# First-release roadmap

Status: **provisional; offline core implemented, vertical slice in progress**. Use [SDLC priorities](sdlc-priorities.md) to keep work tied to the [happy path](happy-path.md). Milestone labels indicate order, not priority grade or authorization. A milestone may span multiple Solopowers workstreams; a workstream is a separately scoped execution unit.

## Milestones

1. [Verify external contracts and decide boundaries](milestones/01-contracts-and-boundaries.md)
2. [Offline reactive vertical slice](milestones/02-offline-reactive-slice.md)
3. [Provider and location integrations](milestones/03-provider-integrations.md)
4. [Release readiness](milestones/04-release-readiness.md)

## Current setup handoff

See the [legacy reactive-crawl research handoff](research/legacy-reactive-crawl.md) for source-checked legacy behavior, its disconnected batch/reactive paths, and first-release design cautions. The [Bright Data MCP research](research/bright-data-mcp.md) surveys agentic tools, Maps scraper discovery, and outstanding contract questions.

Milestone 1 research workstreams and the bounded reactive core in Milestone 2 are complete. The core is in-memory and fixture-tested; the end-to-end crawler, CLI, SQLite integration, geocoder and Bright Data integration are not yet implemented. Milestone 2's durable recovery and offline operator path remain ahead, subject to their own scope and approval. Milestone plans are not permission for paid calls.
