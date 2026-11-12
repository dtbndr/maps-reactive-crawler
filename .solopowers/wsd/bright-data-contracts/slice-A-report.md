# Slice A report: Bright Data discovery and result contracts

**Status:** DONE_WITH_CONCERNS — requested evidence-backed documentation is complete; provider runtime behavior and current requirement status of two legacy query parameters remain explicitly unknown. No decision or external action is authorized by this report.

## Implemented

Updated `docs/research/bright-data-mcp.md` as a current-source handoff for location discovery versus structured place-detail collection. It records country/keyword and optional coordinate/zoom fields, the project's coordinate and bounds constraint, declared URL discovery output versus detail output, and a conditional conclusion on whether details are needed. It compares MCP agent tools with the direct API, keeps the deterministic scheduler project-owned, states detail/coverage implications and unknowns, and preserves historical findings while marking the legacy query parameters unresolved. Current primary source links and access date are recorded in the document.

The two legacy source implementations were checked: `bttrld-prspct-bldr/backend/src/services/maps.js:64-65` and the separately archived `bttrld-prspct-lst-bldr/packages/backend-legacy/src/services/maps.ts:98-99` both use `type=discover_new&discover_by=location`. Their source code proves historical usage only. Current catalog docs use the method name `discover_by_location`; surveyed docs do not establish whether the old query values remain required, so the handoff does not guess.

## Documentation acceptance review / TDD adaptation

This slice changes documentation only and the brief specifies acceptance-gap review in place of a software test.

- **RED (before edit):** Existing `docs/research/bright-data-mcp.md` did not establish all discovery input requirements alongside the project's coordinate requirement; did not make method-level output mapping explicit; left URL-versus-place-record and detail necessity ambiguous; and had no current source/access dates or resolution of legacy trigger parameter status. These are the brief's documented acceptance gaps, not a failing code test.
- **GREEN (after edit):** Acceptance review confirmed that each requested field has catalog evidence or is explicitly unknown; discovery output (`url`) is distinguished from collected place fields (`place_id`, coordinates and others); detail necessity is conditional; direct API and MCP are compared; legacy parameters are corroborated in both checked legacy trees but their present requirement is left explicitly unknown with a concrete next step. Coverage/cost/runtime behavior is not asserted beyond source evidence.
- **Tests added/updated:** None. This documentation-only brief defines gap review as the red/green method; no code or tests were changed.

## Sources and citations

Accessed 2026-11-12; URLs and distinctions are also included in the updated handoff:

- Bright Data primary catalog: https://docs.brightdata.com/scrapers.json
- Bright Data primary detailed catalog: https://docs.brightdata.com/scrapers-full.json — checked Maps full-information dataset `gd_m8ebnr0q2qlklc02fz`, location method schema/declared output, URL collection method schema/declared output.
- Bright Data direct API operation documentation: https://docs.brightdata.com/api-reference/scrapers/search-engines-apis/google-maps-discover-by-location and https://docs.brightdata.com/api-reference/scrapers/search-engines-apis/google-maps-collect-by-url (both returned HTTP 200 during verification).
- Bright Data MCP live README and tool reference: https://github.com/brightdata/brightdata-mcp/blob/main/README.md and https://github.com/brightdata/brightdata-mcp/blob/main/assets/Tools.md (both returned HTTP 200). MCP tool reference documents catalog/detail/run/progress/results tools and says a run waits up to 45 seconds before returning a snapshot ID; the tool description states per-record billing.
- Historical code pointers: `backend/src/services/maps.js:53-65` in the first reference; `packages/backend-legacy/src/services/maps.ts:98-99` in the separately archived reference. No provider call was made.

## Verification

- `git diff --check` — passed.
- `npm run check` — passed: TypeScript typecheck, test suite (1 passed, 0 failed), and TypeScript build.
- `mise install && mise exec -- npm ci && mise exec -- npm run check` — passed: pinned Node 26.13.1 present, dependencies installed, audit reported 0 vulnerabilities, typecheck passed, test suite 1 passed / 0 failed, build passed.
- HTTP status checks for both direct API operation URLs and both MCP GitHub URLs — all returned 200.
- Catalog data inspection confirmed `discover_by_location` requires `country` and `keyword`, declares `lat`, `long`, `zoom_level` optional, and declares `url` output; `collect_by_url` requires `url` and declares place fields including `place_id`, `lat`, and `lon`.
- No live collection, paid call, account change, external publication, or customer-data access.

## Self-review and carry-forward

No tests or production code changed. The research does not treat declared output fields as always populated or claim complete/exhaustive discovery. Remaining material unknowns: legacy trigger query-parameter status; runtime response envelope and URL multiplicity; required-field availability, completeness, limits/pagination, partial failures, coordinates/zoom semantics, duplicate behavior, lifecycle/retries/retention and exact account costs; applicable data terms/attribution/redistribution. For lifecycle/cost work, resolve these from versioned primary sources/provider confirmation before implementation. Any probe requires separate operator approval. Keep scheduler, bounds, work limits, persistence and expansion policy deterministic and project-owned; use synthetic fixtures for the offline reactive slice.
