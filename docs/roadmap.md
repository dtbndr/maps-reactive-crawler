# First-release roadmap

Status: **provisional; implementation not started**. Use [SDLC priorities](sdlc-priorities.md) to keep work tied to the [happy path](happy-path.md). Milestone labels indicate order, not priority grade or authorization. A milestone may span multiple Solopowers workstreams; a workstream is a separately scoped execution unit.

## Milestone 1 — Verify external contracts and decide boundaries

- Verify current Bright Data location discovery, snapshot lifecycle, response schema, limits and error handling; separately identify useful MCP support and document direct API use with notice.
- Evaluate geocoding providers for usage policy, attribution, auth, ambiguity handling and cost. Do not silently default country to US.
- Specify radius/bounding-box behavior, cell-center versus returned-place filtering, provider-required inputs, retry limits and duplicate-paid-request crash windows.
- Review applicable service/data terms and third-party licensing. No paid calls without explicit operator approval.

**Exit:** documented, evidence-backed contracts and unresolved decisions surfaced to the owner.

### Provisional workstream sizing

1. **Bright Data contract and offloading:** Verify Maps discovery and detail behavior, schemas, limits, failures, costs and terms; recommend MCP versus direct API responsibilities. Reuse the existing MCP research. **Outcome:** an evidence-backed provider contract and documented unknowns.
2. **Location-input contract:** Evaluate geocoders, including ambiguity, country handling, attribution and cost. **Outcome:** a recommended location-resolution contract and provider choice or documented blockers. This can draw on provider findings as they become available.
3. **Bounded-crawl and recovery decisions:** Combine the provider and location findings to decide geographic filtering, grid assumptions, work limits, expansion, failures, retries and duplicate-paid-request recovery. **Outcome:** a decision-complete handoff for the offline milestone, with remaining blockers identified. This follows the first two investigations.

Review terms and licensing within the relevant investigations. This sizing is provisional; it does not approve workstream briefs or authorize paid calls, account changes or publication.

## Milestone 2 — Offline reactive vertical slice

- Implement pure grid geometry, a single deterministic reactive scheduler, geographic/work bounds and a fixture-backed provider interface.
- Implement transactional local SQLite checkpoints, place deduplication, failure states, cancellation and resume.
- Connect a thin CLI and library API. Add synthetic end-to-end tests demonstrating seed → results → neighbors → bounded stop → restart/export.

**Exit:** reproducible, credential-free happy-path tests; explicit partial-failure and coverage behavior.

## Milestone 3 — Provider and location integrations

- Implement the verified Bright Data integration and geocoder; use operator-provided credentials and redact secrets from errors and logs.
- Handle provider polling, bounded retries, rate limits and recovery according to verified contracts; document direct API notice and optional agentic MCP support.
- Perform one bounded live test only after explicit authorization and report cost and limitations.

**Exit:** offline integration tests pass and an approved live run demonstrates the intended path, or blockers are documented.

## Milestone 4 — Release readiness

- Finalize README, installation, CLI/library documentation, safety/coverage caveats, contributor guidance and security reporting channel.
- Verify clean builds and offline tests; review secret scans, dependencies, licenses, attribution and collected-data restrictions.
- Confirm naming, package metadata, maintainer and publishing configuration. Obtain separate approval for public Git hosting and any package publication.

**Exit:** owner accepts a reproducible first release and separately authorizes any publication.

## Current setup handoff

See the [legacy reactive-crawl research handoff](research/legacy-reactive-crawl.md) for source-checked legacy behavior, its disconnected batch/reactive paths, and first-release design cautions. The [Bright Data MCP research](research/bright-data-mcp.md) surveys agentic tools, Maps scraper discovery, and outstanding contract questions.

This is a scaffold only: no crawler, CLI, SQLite integration, geocoder or Bright Data integration exists yet. Start with Milestone 1. Milestones and exit criteria are planning artifacts, not evidence of completion or permission for paid calls.
