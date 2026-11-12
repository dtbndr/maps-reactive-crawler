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

## Slice B: current candidate comparison

Research date: **2026-11-12**. The checks below use public provider/project documentation and policy pages only; no API or geocoding endpoint was called. A documentation page is evidence of what it states, not a runtime test, entitlement, or approval for this application. Provider prices and policies can change and must be rechecked before a future provider decision.

### Documentation-only RED check (before comparison)

At Slice B start, all three candidates failed the evidence check for the safety-critical contract: intended-use permission for this distributed operator-run crawler; free use at a known workload; applicable throttling across concurrent/shared-IP/account/application scopes; credential model; and retention/export/data rights. Ambiguity, country, and attribution evidence was also incomplete. This is an evidence failure, not a finding that every candidate is prohibited. The workload/aggregate assumptions in the previous section remain unknown.

### Candidate evidence and criterion disposition

| Criterion | Nominatim public service | Photon public/hosted or self-hosted | Geoapify Geocoding API |
|---|---|---|---|
| Intended use and free eligibility | **Unresolved.** OSMF's public Nominatim policy says the service is donation-funded and capacity-limited and reserves the right to limit/withdraw access; it does not establish eligibility for this crawler's unknown aggregate workload. No price/eligibility assurance for this use. | **Unresolved.** Photon source/project documentation is not a service agreement for a third-party/public endpoint. A self-hosted deployment is not free of hosting/operations costs. | **Unresolved.** API docs/pricing page are published, but a public displayed plan/allowance does not establish this app's eligibility or sufficient capacity across independent operators. Account-specific entitlements and workload are unknown. No free-use claim accepted. |
| Policy and rate-limit scope | **Partially evidenced; not passed.** OSMF policy states an absolute maximum of 1 request per second, requires an identifying User-Agent/Referer, caching, and attribution. The policy warns against autocomplete and systematic/bulk use and allows access to be withdrawn. It gives no safe allowance for aggregate requests from independent crawler installations or shared egress. There is no documented evidence here for a concurrency allowance beyond the one-request-per-second ceiling; compliance for the intended aggregate cannot be demonstrated. | **Unresolved.** Project docs describe a geocoder, not authoritative usage terms, a public endpoint's service-wide quotas, shared-IP throttles, or concurrency guarantee. Self-hosting changes endpoint capacity but does not resolve data-source terms, operating cost, or legal workload. | **Unresolved.** API/pricing pages describe product access/plan concepts but do not establish a complete per-IP, per-key, per-account, concurrent, and aggregate limit for this unknown use. No proposed request schedule can honestly be certified compliant without actual plan terms and workload. |
| Authentication / independent operators | Policy requires app identification, not a user key. Shared identification does not prove aggregate eligibility. | Depends on the actual endpoint/deployment; project source does not establish hosted endpoint authentication or credential terms. | API key/account model is documented for API use. Whether each operator needs their own account/key, allowed key distribution/restrictions, and applicable plan entitlements for this CLI need confirmation in binding current terms. No shared key is proposed. |
| Ambiguity and country | Search API documents structured/free-form search, country-code filtering (`countrycodes`), and result fields; these do not prove an ambiguity threshold or safe automatic selection. Explicit operator confirmation remains necessary. | Project API documents search/filter parameters including country and language-related options; no documented contract found here guaranteeing ambiguity/confidence semantics suitable to select a unique location. | Forward API documents country filtering (`filter=countrycode:...`) and language selection options. The documentation does not establish a universally reliable ambiguity decision rule; results must not be treated as unambiguous without operator confirmation. |
| Attribution | OSMF public-service policy requires attribution. Exact placement/format in CLI and exports for this workflow is not settled. | Source/project and the specific host's terms/data sources must be assessed separately; no confirmed requirement/permission for this deployment. | Current API docs and pricing alone do not settle required attribution placement or whether CLI-only/export output meets all applicable terms. Unresolved. |
| Caching, local checkpoint and export | OSMF policy says results must be cached and not repeatedly requested; this is not permission for arbitrary retention or redistribution. The policy plus OSM data licensing must be assessed against persistent coordinates, labels, provenance, country, checkpoint and exports. | No authoritative hosted terms or complete source-data/right-to-export terms for a selected deployment have been established. Open-source code licensing is not geodata rights. | API documentation/pricing do not settle persistence duration or rights to retain/export all requested query, coordinates, labels, provenance and country. Contract/terms evidence required. |
| Overall | **Unresolved; do not use on evidence available.** Public policy has restrictive use requirements but does not explicitly decide this particular workload; do not label the candidate prohibited solely from missing aggregate evidence. | **Unresolved; do not use on evidence available.** Hosted and self-hosted are materially distinct and neither is qualified. | **Unresolved; do not use on evidence available.** A paid plan or free allowance cannot be presumed, and use must be free for the intended use. |

### Source register (accessed 2026-11-12)

- OSMF, [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/): public service policy, maximum request frequency, identification, caching, attribution, restrictions on autocomplete/systematic/bulk use, and service withdrawal. This applies to the public OSMF service, not automatically to separately operated Nominatim instances. It does not publish an aggregate allowance for this crawler's unknown multi-operator workload.
- Nominatim, [Search API](https://nominatim.org/release-docs/latest/api/Search/): search parameters/results, including country code filtering. API behavior documentation is not permission to use the OSMF endpoint and does not itself establish safe ambiguity resolution.
- Komoot, [Photon project repository and documentation](https://github.com/komoot/photon): project/API information and deployment options. Repository/open-source status does not establish terms or quota for a hosted endpoint, free hosting, data rights, service availability, or operator workload eligibility. No endpoint was contacted.
- Geoapify, [Forward Geocoding API documentation](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/): query options, including country and language-related parameters, and API access documentation. Does not independently settle entitlement, all throttling scopes, ambiguity, or retention rights.
- Geoapify, [Pricing](https://www.geoapify.com/pricing/) and [Terms and Conditions](https://www.geoapify.com/terms-and-conditions/): public commercial-plan/terms sources. A pricing page is mutable and is not account-specific proof of free eligibility or aggregate capacity. A full terms-to-workload and storage/export determination remains open; no specific allowance is used as a qualifying claim.

### Documentation-only GREEN recheck and blockers

All initial evidence gaps were rechecked. The policy/API facts above narrow some technical questions, but **none of the candidates meets the mandatory gate**: free intended use and compliance with every applicable rate limit, including concurrent/shared IP/account/application and aggregate scopes, must be established. The operator workload, number of installations, concurrency, shared egress, retry/batch behavior, and desired credentials remain unknown. In particular, public documentation does not establish a shared public-service aggregate allowance adequate for this use. No candidate has been called disqualified where evidence only shows documentation silence; no candidate is supported by inference from a missing price or quota.

Required next evidence actions before contract synthesis or provider selection:

1. Owner establishes the workload model and whether each operator supplies a personal credential; do not assume a shared public endpoint or shared credential.
2. For the selected candidate/deployment, obtain current authoritative written confirmation of intended-use permission and every relevant rate-limit scope under that workload, including concurrent requests and aggregate/shared-IP behavior. For Geoapify, confirm exact plan eligibility, limits and terms rather than extrapolating displayed pricing. For hosted Photon, identify the endpoint operator and terms. For Nominatim public service, resolve whether crawler traffic fits its stated restrictions; the 1 req/s ceiling alone is insufficient.
3. Resolve exact attribution, ambiguity/country behavior, persistent checkpoint/export rights and source-data terms with authoritative sources before defining the contract. A provider response's coordinate and label do not alone authorize indefinite storage or redistribution.

**Documentation-only GREEN means the comparison and remaining gaps are explicit; it does not mean any provider passed.** No paid/live requests, account creation, publication, integrations, secrets, or real data were used. No provider is selected. Do not proceed to implementation or make a provider-specific contract claim until the blockers above are resolved.

**Decision boundary:** Keep location resolution explicit, require operator confirmation for ambiguous results, and do not default to the US. Any provider selection, workload assumption, or credential model not supported by evidence requires owner approval.
