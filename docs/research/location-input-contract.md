# Location-input geocoder evaluation

Status: evidence inventory for Slice A; **no provider selected**. The CLI and geocoder are not implemented. This documents evaluation criteria and candidate evidence for the first-release operator-run workflow, not a provider contract or authorization to make requests.

## Initial documentation-only red check (before research)

At the start of this investigation, the repository and first-release description did not contain evidence sufficient to accept any geocoder. Specifically missing were:

- **Intended use/workload:** explicit supported operator workflow and expected number of geocoding requests per installation, operator, and all users combined.
- **Free eligibility:** current pricing, eligibility for this public open-source tool and its operators, and whether use is free at the expected volume.
- **Applicable policy:** provider terms, acceptable-use policy, service-specific restrictions, and whether deployment/use by independent operators is allowed.
- **Quotas and rate-limit scope:** per-key/account/IP/application limits and aggregate limits across operators or the shared public service; burst and sustained limits.
- **Authentication:** whether a key/account is required, how credentials may be supplied, and restrictions on client-side/public distribution.
- **Ambiguity:** multiple-match behavior, confidence/relevance evidence, and whether results can be presented for explicit operator confirmation instead of guessing.
- **Country:** supported country filters, country-code convention, language/locale behavior, and absence of a silent US default.
- **Attribution:** required wording, display placement, and whether CLI/export-only output satisfies the requirement.
- **Storage and rights:** caching/retention and reuse rules for query and result data, applicable source-data/database rights, and limits on redistribution/export.

This is the documentation-only RED state: no candidate has demonstrated all of the acceptance evidence. This slice does not add code tests because its artifact is a research comparison and no resolver implementation exists; evidence is checked against the criteria below instead.

## Workload and assumptions to confirm

**Provisional workload model (inference, not measured):** one operator provides one coordinate or human-readable place to seed a bounded crawl. A place seed should require one forward-geocoding operation; retries, disambiguation, and operator edits add requests. Crawls may be run repeatedly. The crawler can be installed by many independent operators, so there is no defensible assumption that aggregate traffic is limited to one developer or one installation. The project should not silently multiplex operators through a shared service.

**Unknown operator behavior:** installation count, concurrent use, geocoding frequency, retry behavior, automated/batch use, and whether operators will configure their own key are not established. No free-tier or public-instance quota is accepted until its scope can accommodate the intended aggregate workload or a per-operator-key design is approved. Owner confirmation is required for workload and credential model.

## Evaluation criteria

A candidate can be recommended only when current authoritative evidence supports all first-release requirements:

1. Use is permitted for this operator-run software and eligible at no charge for the declared workload; free tier is not equivalent to permission or sufficient shared capacity.
2. Applicable policy and rate limits are explicit, including aggregate scope, and a compliant request/retry model can be stated.
3. Authentication and independent-operator credential handling fit the CLI without embedding a shared secret.
4. Results support explicit country context and language as appropriate; no country is silently inferred as US.
5. Ambiguous or low-confidence results can be surfaced for operator choice; no result is silently treated as a definitive location.
6. Attribution can be met in CLI and exported documentation/output.
7. Caching, retention, derived data, export, and source-data/database rights permit the planned checkpoint and result workflow.
8. Provider service availability and geocoder coverage are suitable enough for the first-release happy path, with failure and unsupported-location behavior documented.

P0/P1 focus: policy/eligibility, aggregate limits, unsafe silent location choice, credentials, and rights could block a safe first release (P0/P1 depending on evidence and workaround). Language/coverage gaps may be P1 where they prevent correct location input; cosmetic output preferences are lower priority. This is evaluation sequencing, not a priority regrade of implementation tasks.

## Plausible candidates (not endorsements or eligibility claims)

| Candidate | Inclusion rationale | Evidence now / limits |
|---|---|---|
| OpenStreetMap Foundation Nominatim public service | A commonly used geocoding API with a published public-service usage policy, useful as a policy-constrained comparison point. | The public endpoint policy is authoritative for its service. Its existence does **not** establish that an independently installed crawler or its aggregate traffic is acceptable. Must verify current policy wording, identification, rate limit and scope, caching, attribution, acceptable use, and OSM data rights before considering it. |
| Photon (Komoot project; public instance or self-hosted deployment are distinct options) | Open-source geocoder with forward-geocoding and country/language-related query capabilities described by project documentation; provides a hosted-vs-self-hosted comparison. | Project source/docs do not by themselves establish the terms, quota, availability, or free eligibility of any public hosted endpoint. Self-hosting is not cost-free operationally and requires a separate data/update/hosting and rights assessment. |
| Geoapify Geocoding API | Commercially operated API with public geocoding documentation and pricing information; a plausible API-key/free-tier comparison candidate. | Pricing/quotas and service terms are mutable and account/plan-dependent. A displayed free allowance alone does not prove eligibility, adequate aggregate capacity, or permission for this application's intended use. Verify attribution, storage, country/ambiguity support, and key restrictions against current terms. |

These candidates are included to compare materially different delivery models (public shared endpoint, open-source/self-hosted or hosted project service, and commercial key-based API). No provider was contacted, queried, or selected. The candidate list is not exhaustive; any expansion should be evidence-led and remain within the approved scope.

## Evidence ledger

Access date for the listed public documentation pages: **2026-11-12**. These are source locations for evaluation, not a claim that every relevant clause was fully resolved. Pricing, policies, endpoint status, and terms can change; recheck at Slice B. No account was created and no provider API/live geocoding request was made.

| Topic | Authoritative source location | Documented fact / inference / unknown |
|---|---|---|
| Nominatim service policy | [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) | **Documented fact:** OSMF publishes a policy specifically for use of its public Nominatim service. **Unknown:** applicable interpretation for this application's distributed operators, aggregate traffic scope, and current detailed requirements must be checked against the live policy before adoption. |
| Nominatim API behavior | [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/) | **Documented fact:** the project documents search parameters and response behavior. **Unknown:** sufficient disambiguation/quality behavior for the intended inputs and exact version/endpoint behavior require comparison; documentation does not grant use of the public service. |
| Photon project and API | [Komoot Photon repository](https://github.com/komoot/photon) | **Documented fact:** an open-source Photon project and API documentation exist. **Unknown:** public instance terms/limits and self-hosted operating costs, data sourcing/refresh, attribution and rights must be independently established. |
| Geoapify geocoding | [Forward Geocoding API documentation](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/) | **Documented fact:** Geoapify publishes an API-specific geocoding reference. **Unknown:** match ambiguity contract, country semantics, current key restrictions, retention/export terms and compatibility with CLI attribution need verification. |
| Geoapify pricing | [Geoapify pricing](https://www.geoapify.com/pricing/) | **Documented fact:** Geoapify publishes plan/pricing information. **Unknown:** current free-tier eligibility and aggregate quota for this precise intended use; do not treat a free allowance as proof. |
| Project workload and constraints | [First-release happy path](../happy-path.md), [Milestone 1](../milestones/01-contracts-and-boundaries.md), [README](../../README.md) | **Documented fact:** initial location may be a coordinate or human-readable location; ambiguity must not be silently guessed; country is required as the verified provider requires; providers/terms remain unverified. **Inference:** an operator-run crawler can have many independent installations, so shared service traffic cannot be presumed to stay within a single-user allowance. |

**Source access limitations/conflicts:** No provider-specific source was treated as proving the whole contract. A provider's API or pricing page cannot establish public endpoint aggregate policy, and a project's open-source license cannot establish hosted-service terms or source-data rights. No inaccessible source or conflicting fact was confirmed during this slice; unresolved items are listed as unknown rather than inferred away.

## Criteria recheck and Slice B evidence gaps (documentation-only GREEN)

Rechecking the initial gaps against the criteria and ledger: intended use/workload and aggregate traffic are still assumptions requiring owner confirmation; free eligibility, policy applicability, quota scope, authentication/key restrictions, ambiguity resolution, country behavior, attribution, and storage/rights remain unverified for each candidate. Accordingly no candidate passes and no recommendation is made. The handoff is ready for Slice B comparative verification, with this evidence checklist and workload model carried forward.

**Decision boundary:** Slice A does not choose a provider, define implementation API, authorize a paid request/account change/publication, or establish a production geocoding contract. Keep location resolution explicit and require operator confirmation for ambiguous results; do not default to the US pending a documented decision.
