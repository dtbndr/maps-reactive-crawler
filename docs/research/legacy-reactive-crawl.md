# Legacy reactive-crawl research handoff

**Status:** research only. This scaffold has no crawler, geocoder, Bright Data client, or SQLite implementation. The observations below come from two separate reference repositories' source trees; they are not evidence of behavior in this project or of a currently operating service. Source paths are relative to each reference repository and are intentionally kept generic.

## Evidence and source boundaries

Two implementations surfaced in the scout work and were checked against source:

1. One backend reference has `backend/src/controllers/company/search.js`, `backend/src/services/geocoding.js`, `backend/src/services/gridCrawler.js`, and `backend/src/services/maps.js`. Its `/search` handler wires a batch Maps workflow, while the same grid service also contains an unconnected reactive loop.
2. A separate service reference has `packages/backend-legacy/` and explicitly marks it archived/outside the active workspace in its root `AGENTS.md`. Its legacy search and crawler have the analogous batch-vs-reactive distinction. Do not combine the two repositories into one implementation or infer that either is active here.

The paths cited below are source-relative pointers into these reference trees. The descriptions of code are **observed legacy facts**; target behavior and recommendations are marked separately. Both codebases delegate Maps data collection to Bright Data; they do not show browser-driven Maps UI scrolling, DOM extraction, or result-page traversal. The provider's internal extraction behavior is not visible in repository code.

## What the legacy code does

### Location input, geocoding, and initial grid

In the first reference, `backend/src/controllers/company/search.js` accepts `query.keywords` and a city string (`query.city`), with a zoom default, and calls `resolveCityCentroid`. `backend/src/services/geocoding.js` sends the city text to the Nominatim search endpoint, requests one result, and returns its center and bounding box (in `[south, north, west, east]` order). The route requires a bounding box and derives a country code, with a US fallback. It does not start from operator-supplied coordinates or an explicit radius/bounding box.

`backend/src/services/gridCrawler.js` projects coordinates into Web Mercator pixel space and uses a nominal 1920-by-1080 viewport and stride to generate grid centers covering that geocoder-provided box. The route persists those cells and sends them together as one initial batch. The separate archived implementation uses city input and geocoding in `packages/backend-legacy/src/controllers/company/search.ts`, and its legacy grid logic likewise builds a city grid. These are not examples of a single operator-selected seed with an explicit bounded search area.

### Batch route versus the separate reactive loop

In the first reference, the `POST /search` route in `backend/src/controllers/company/search.js` generates the city grid, stores the cells, calls `triggerMapSearch` once with all initial locations, associates the returned snapshot ID with cells, then invokes `processBatchSnapshot`. In `backend/src/services/gridCrawler.js`, `processBatchSnapshot` only marks the query as polling and returns; the route's batch path does not call `runReactiveCrawl`. The corresponding snapshot poll/fetch endpoints are in `backend/src/controllers/company/searchQueries.js`.

That same `gridCrawler.js` separately defines `processNextGridCell` and `runReactiveCrawl`. The latter selects one pending cell, triggers a one-location request, polls for results, stores results, and queues cardinal neighbors when the raw result array is nonempty. Source search found no caller of `runReactiveCrawl` in that reference. Thus it is implemented code, but not shown as reachable from the inspected `/search` flow. The archived reference also has separate batch setup in `packages/backend-legacy/src/controllers/company/search.ts` and a distinct `runReactiveCrawl` in `packages/backend-legacy/src/services/gridCrawler.ts`; its root instructions identify `backend-legacy` as archived, not an active package. Neither reference establishes that the reactive loop runs in production.

### Bright Data interaction, expansion, limits, deduplication

Observed legacy code constructs location/keyword/country records and posts to Bright Data's dataset trigger endpoint using parameters including `type=discover_new` and `discover_by=location`. It receives a snapshot ID, checks progress, and downloads a JSON snapshot when ready. The first reference exposes this in `backend/src/services/maps.js`; it also archives downloaded data locally. Search-query endpoints provide separate snapshot polling and fetching. The reactive implementation waits before polling (the source describes a five-minute initial wait) and has a bounded polling loop with exponential delays and a 30-minute cap. Those are implementation details, not recommendations for a new client.

The reactive loop expands geographically to north/south/east/west neighbor centers after a cell has raw results. It checks whether neighbor coordinates have already been visited before inserting them. The expansion condition is raw result count, not count of newly inserted companies. The orchestration also has a `maxSteps` default and a target-company limit in its context. These are work controls, not proof of a geographic boundary.

Results without `place_id` are skipped in the reactive path. The first reference's company repository uses a Google place ID conflict guard and also checks website duplication; only new companies receive search-result associations. This is database-backed deduplication behavior in that implementation, not a portable provider guarantee. The archived reference similarly requires place IDs in its reactive persistence path. In the inspected reactive expansion code, no explicit radius/bounding-box clipping is evident; do not describe its expansion as geographically bounded. A city bounding box is used for the initial grid, but is not evidence that subsequent neighbors stay within it.

## Evidence limits and provider uncertainty

- The repositories show API request construction, polling, JSON consumption, and local persistence. They do not establish Bright Data's current endpoint contract, dataset configuration, required fields, status semantics, rate limits, result completeness, pagination, pricing, or terms.
- Dataset identity/schema and actual Maps extraction behavior are external to the checked-in application code. Do not claim how Bright Data traverses Maps pages or scrolls.
- A code comment or hard-coded value is evidence of what that legacy source attempted, not confirmation that the provider still accepts it.
- City geocoding via Nominatim in a legacy implementation is not approval or recommendation to reuse it. Current usage rules, attribution, ambiguity handling, and suitability require separate verification.
- No live provider calls or paid tests were made for this handoff.

## Decisions for this project's first release

These are **target decisions and handoff points**, not implemented behavior; align implementation with [the happy path](../happy-path.md) and roadmap Workstream 1:

- Begin with exactly one explicitly selected seed: either latitude/longitude or a human-readable address/location. For text input, resolve it, display the chosen result, and require disambiguation rather than silently accepting an ambiguous match.
- Require an explicit radius or bounding box, plus independent work limits (such as cells/provider calls and elapsed time). Decide and test whether the geographic limit applies to cell centers, returned place coordinates, or both. Do not claim strict result containment without reliable place coordinates and filtering.
- Keep geographic area and work limits independent. Neighbor fan-out must respect the chosen boundary and report a clear stop reason; tests should cover no expansion outside bounds, duplicate places, provider failures, cancellation, and resume.
- Use Bright Data with operator-provided credentials (BYOK); securely handle and redact credentials. Direct API integration is permitted with notice but requires current contract verification before implementation. MCP is optional agentic support, not a scheduler prerequisite or bundled credential path.
- Prefer an offline fixture-backed provider boundary and deterministic scheduler before any live integration. Do not make a paid call without explicit operator approval.

## First-release handoff

Start with Workstream 1 in `docs/roadmap.md`: verify current provider and geocoder contracts, document unresolved boundary and retry decisions, and review data/service terms. Then implement the single-seed, bounded reactive path with synthetic tests and local checkpoints as specified by `docs/happy-path.md`. Keep this legacy research as a cautionary reference: an initial batch route and a separately defined reactive loop are not interchangeable, and geographic fan-out alone does not guarantee exhaustive or bounded coverage.
