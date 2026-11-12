# Bright Data MCP: first-release research

**Status:** research handoff, not an integration decision or evidence that Milestone 1 is complete. This reviews Bright Data's public MCP repository at commit [`258f368ecf06556be7a63b2e3c259f94d9349f89`](https://github.com/brightdata/brightdata-mcp/tree/258f368ecf06556be7a63b2e3c259f94d9349f89) and its live scraper catalog, which can change independently. No Bright Data account, MCP session, scraper run, or paid call was used. Catalog descriptions are not a tested runtime contract.

## What is available

The [MCP README](https://github.com/brightdata/brightdata-mcp/blob/258f368ecf06556be7a63b2e3c259f94d9349f89/README.md) describes a hosted remote server and a locally launched server, both using an operator's API token. Its documented tool surface includes:

- **Web research:** `search_engine`, `scrape_as_markdown`, batch variants, and `ask_brightdata_assistant` for questions about Bright Data products and setup.
- **Structured scrapers:** `search_scrapers` discovers catalog entries; `get_scraper_details` describes an entry and method; `run_scraper` starts collection; `get_scraper_progress` and `get_scraper_results` retrieve asynchronous runs; `refresh_scrapers` refreshes the catalog. A run waits up to 45 seconds before returning a snapshot ID if still running. The README says records are billed per record and discovery defaults to 10 records per input unless `limit_per_input` is set.
- **Other tools:** interactive `scraping_browser_*` tools, AI-insight tools, session call statistics, and stored-dataset search. The latter is documented for LinkedIn datasets, not as a Google Maps dataset search interface.

See the [tool reference](https://github.com/brightdata/brightdata-mcp/blob/258f368ecf06556be7a63b2e3c259f94d9349f89/assets/Tools.md). The repository documents local `GROUPS`/`TOOLS` or hosted `groups`/`tools` selectors, including a `scrapers` group. The available tools depend on server version and configuration; inspect the actual server's advertised tools instead of assuming this exact inventory. Older `web_data_*` selections are described as compatibility aliases that enable scraper tools, not evidence that every legacy tool remains individually callable.

## Google Maps discovery: promising, but not yet verified end-to-end

The public [scraper catalog](https://docs.brightdata.com/scrapers.json) lists **Google Maps full information** (`gd_m8ebnr0q2qlklc02fz`) with `discover_by_location`, `discover_by_place_id`, `discover_by_cid` and `collect_by_url`. Separate Maps reviews and images scrapers are URL-based. The [detailed catalog](https://docs.brightdata.com/scrapers-full.json) lists the location method's `country` and `keyword` as required and `lat`, `long`, and `zoom_level` as optional. The project's intended coordinate-driven flow still needs explicit coordinates regardless of catalog optionality; do not silently invent a country.

The detailed catalog lists `url` as the location discovery output, while its `collect_by_url` method lists fields including `place_id`, `lat` and `lon`. This is **not proof** that a discovery run returns full place records, that all coordinates are present, or that a second collection step is necessary: verify actual method behavior, returned shape, limits and costs before choosing the integration. In particular, a discovery record cap could affect raw-result-driven expansion and coverage.

For an authorized agentic investigation, the natural sequence is `search_scrapers` → `get_scraper_details` for the location method →, only after approval for any potentially billable collection, a small `run_scraper` → progress/results if needed. Merely describing this sequence does not authorize it. Record schemas and operational behavior using synthetic/redacted examples, not real customer data.

## Recommended division of responsibility

- **Offload to Bright Data:** public Maps discovery and, if verified necessary, place-detail extraction; Bright Data also supplies the scraper infrastructure and asynchronous snapshot mechanism. Use MCP discovery/details and support tools to help an agent investigate provider capabilities; verify their answers against primary documentation.
- **Keep in this project:** deterministic single-seed scheduling, geometry and geographic/work bounds, decisions about expansion from raw results, persistence and deduplication, error classification, cancellation/resume, stop reasons, export and coverage disclosure. An MCP agent or browser session is not a durable scheduler or a substitute for these guarantees.
- **Integration remains open:** MCP can assist development and operator workflows, but it is not mandatory in the runtime. Compare an MCP adapter with the direct Web Scraper API after verifying contracts; direct API use is permitted with notice. Do not add browser automation, reviews, generic web search or AI-insight calls to the first-release crawl merely because MCP offers them.

## Safety, cost and remaining decisions

The README advertises a free allowance and pay-as-you-go rates, but also says scraper runs are billed per record. Eligibility, account configuration, what counts as a request or record, discovery versus detail charges and present pricing must be checked for the operator's account; do not assume a Maps crawl is free. Obtain explicit approval before paid calls, live collection or account changes. Hosted setup documents a token in the connection URL: treat the entire URL as secret, keep it out of logs and shared configuration, and use operator-provided credentials. Scope enabled tools, protect against untrusted web content and do not disable safeguards casually.

Before implementation, verify the direct API and MCP versions of location inputs and output shapes, coordinate/zoom semantics, record caps and pagination, country formats, lifecycle statuses, snapshot retention, failure and partial-error representation, retries/rate limits and duplicate-paid-request crash windows. Also verify terms, attribution and redistribution rights. Decide cell-center versus place filtering and how missing coordinates, incomplete results and empty versus failed runs affect expansion. No source here establishes exhaustive geographic coverage or a geocoding solution.

**Next milestone:** incorporate these findings into the wider [Milestone 1](../milestones/01-contracts-and-boundaries.md) contract and boundary decisions, then build the fixture-backed offline reactive slice in [the happy path](../happy-path.md).
