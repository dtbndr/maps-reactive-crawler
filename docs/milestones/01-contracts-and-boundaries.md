# Milestone 1 — Verify external contracts and decide boundaries

- Verify current Bright Data location discovery, snapshot lifecycle, response schema, limits and error handling; separately identify useful MCP support and document direct API use with notice.
- Evaluate geocoding providers for usage policy, attribution, auth, ambiguity handling and cost. Do not silently default country to US.
- Specify radius/bounding-box behavior, cell-center versus returned-place filtering, provider-required inputs, retry limits and duplicate-paid-request crash windows.
- Review applicable service/data terms and third-party licensing. No paid calls without explicit operator approval.

**Exit:** documented, evidence-backed contracts and unresolved decisions surfaced to the owner.

## Provisional workstream sizing

1. **Bright Data contract and offloading:** Verify Maps discovery and detail behavior, schemas, limits, failures, costs and terms; recommend MCP versus direct API responsibilities. Reuse the existing MCP research. **Outcome:** an evidence-backed provider contract and documented unknowns.
2. **Location-input contract:** Evaluate geocoders, including ambiguity, country handling, attribution and cost. **Outcome:** a recommended location-resolution contract and provider choice or documented blockers. This can draw on provider findings as they become available.
3. **Bounded-crawl and recovery decisions:** Combine the provider and location findings to decide geographic filtering, grid assumptions, work limits, expansion, failures, retries and duplicate-paid-request recovery. **Outcome:** a decision-complete handoff for the offline milestone, with remaining blockers identified. This follows the first two investigations.

Review terms and licensing within the relevant investigations. This sizing is provisional; it does not approve workstream briefs or authorize paid calls, account changes or publication.
