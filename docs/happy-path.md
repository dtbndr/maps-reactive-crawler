# First-release happy path

Status: **target, not implemented end to end**. The offline bounded traversal core and synthetic durable-recovery/result-identity behavior are implemented and tested; the CLI, live provider and geocoder integrations are not. Exact CLI flags, provider contracts, result fields, boundary semantics and geocoding provider remain to be specified.

1. The operator installs the tool and configures their own Bright Data API key securely.
2. The operator supplies a search keyword, country as required by the verified provider, and either a latitude/longitude pair or a human-readable location. A human-readable location is resolved and displayed; ambiguity must not be silently guessed.
3. The operator explicitly supplies a geographic radius or bounding box and independent bounds on work such as provider calls/cells and elapsed time. Validate inputs and communicate the resolved location and estimated limits before collecting.
4. The crawler begins with **one seed cell**, collects location results, persists state and deduplicates places, and queues eligible north/south/east/west neighbors when raw results are nonempty. It continues until the queue is exhausted or an explicit limit, cancellation or failure stops it.
5. The operator can inspect status, resume an interrupted crawl where supported, and export results with provenance and an honest stop reason. Failures are not treated as empty results. Credentials never appear in output.

## Acceptance boundaries

- Offline tests exercise the bounded traversal and synthetic durable state/recovery behavior, including restart and fixture-declared verified identity. They do not demonstrate an end-to-end crawler or live provider semantics.
- Implemented offline eligibility checks constrain cell centers to the configured geographic bounds. They do not establish a returned-place filtering policy: output filtering/reporting semantics remain unspecified. Do not claim strict place boundaries without reliable coordinates and filtering.
- Clearly explain that spatial expansion can miss disconnected areas and provider results may be incomplete; it is not exhaustive coverage.
- A real bounded end-to-end run is separately approved by the operator and may incur charges. No paid calls are part of default tests.
- MCP supports agentic workflows; it is not a requirement for an LLM to run the scheduler. Direct API usage is allowed with notice and must be documented.

## Out of scope for the first release

Prospecting CRM, enrichment and scoring, web UI, hosted or multi-tenant service, bundled credentials, whole-city batch seeding, an LLM-controlled scheduler and a new MCP server.
