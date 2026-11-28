# Milestone 3 — Provider and location integrations

- Implement the verified Bright Data integration and geocoder; use operator-provided credentials and redact secrets from errors and logs.
- Handle provider polling, bounded retries, rate limits and recovery according to verified contracts; document direct API notice and optional agentic MCP support.
- Perform one bounded live test only after explicit authorization and report cost and limitations.

**Exit:** offline integration tests pass and an approved live run demonstrates the intended path, or blockers are documented.

## Provisional workstream sizing

These workstreams and their order are a planning proposal, not implementation authorization or an estimate of slice count. Each workstream requires its own scope and operator-approved brief; dependencies and sizing may change as current contracts are verified. Apply the [SDLC priorities](../sdlc-priorities.md) to the first-release [happy path](../happy-path.md). Synthetic tests are credential-free and do not establish live-provider behavior.

### Workstream 1 — Bright Data discovery integration

Status: complete for the fixture-tested guarded discovery path; live behavior remains unvalidated and requires separate authorization and applicable evidence. See the [workstream brief](../workstreams/2026-11-27-bright-data-discovery/brief.md) for limitations.

Refresh the current Bright Data Maps discovery and lifecycle contracts and compare direct HTTP with the JavaScript SDK before choosing an integration. Connect the existing bounded scheduler to discovery for one confirmed coordinate seed, keyword and country as required by the verified contract, explicit geography and independent work limits. Each operator supplies their own `BRIGHT_DATA_API_KEY`; credentials are never bundled, logged or stored in checkpoints. Keep scheduling and recovery project-owned, document direct API use with notice, and retain MCP as optional agentic support rather than a runtime requirement.

Use synthetic integration tests for submission, polling, bounded failure handling and durable recovery. Preserve observation of known provider IDs and do not blindly resubmit when acceptance is uncertain or an acknowledgment is lost. Missing contract evidence blocks the affected behavior; it does not justify inventing semantics or making an unapproved probe.

**Depends on:** Milestone 2's offline path and refreshed provider evidence. **Outcome:** a fixture-tested, bounded discovery path, or documented contract blockers. **Risk:** uncertain submission, provider errors or throttling could cause duplicate paid work or hide gaps.

### Workstream 2 — Place details and result identity

Status: complete for synthetic discovery attribution and export; live provider behavior and detail execution remain unvalidated. See the [workstream brief](../workstreams/2026-11-28-place-details-result-identity/brief.md).

Connect synthetic discovery response attribution and export, preserving provenance and distinguishing verified identity, missing fields and unresolved detail gaps. This output work does not execute detail requests; detail request admission and recovery remain separate future work requiring a verified contract. Synthetic acceptance includes recovery and partial outcomes, not a live demonstration. Before any later live demonstration, reassess GitHub #4 and #5 and applicable contract, rights and pricing evidence.

**Depends on:** Workstream 1 and synthetic discovery fixtures for the completed export. Future detail request admission and recovery require a verified detail contract and are separate from response attribution and export. **Outcome:** deduplicated fixture-verified place output with provenance in credential-free integration tests. Candidate URLs alone are not place records. **Risk:** live provider identifiers, coordinates and completeness remain unverified; do not claim strict returned-place filtering or exhaustive coverage.

### Workstream 3 — Location input and live acceptance

Implement a supported geocoder under the settled independent-operator model; do not silently choose a shared public default. Recheck the selected service's current policy, attribution and applicable safeguards. Require explicit country and candidate confirmation for text lookup; confirmed coordinates bypass geocoding. Exercise location handling and the connected operator path with synthetic fixtures, including stop reasons, recovery and coverage limitations.

**Depends on:** Workstreams 1 and 2 for connected acceptance, and a geocoder choice supported by current evidence. **Outcome:** credential-free integration acceptance and one approved bounded live demonstration, or documented blockers; a blocker is not a successful demonstration. **Risk:** geocoder policy, provider behavior or data rights may prevent safe use or a representative live run.

Before any spend, provide the operator an estimate, including any inability to bound the cost, together with the proposed work and stop limits, and wait for explicit approval. Any live test, paid call, publication or external account change requires separate operator authorization. If a live test runs, report its actual cost and limitations. The [provider](../research/bright-data-mcp.md) and [location-input](../research/location-input-contract.md) handoffs record known uncertainties and the settled independent-operator decisions.
