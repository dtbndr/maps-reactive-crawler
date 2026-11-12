# Slice A report — location input contract

## Status

Implemented Slice A documentation-only comparison at `docs/research/location-input-contract.md`. No provider is selected and no integration or live provider request was made.

## Work completed

- Recorded the initial documentation-only RED evidence gaps before candidate evaluation: intended workload, free eligibility, policy, quota/rate-limit scope, authentication, ambiguity, country, attribution, storage, and rights.
- Defined the evaluation criteria and explicitly modeled per-installation/operator/all-user aggregate workload as unknown. Flagged the workload and credential model for owner confirmation.
- Listed Nominatim, Photon (hosted versus self-hosted distinction), and Geoapify as plausible candidates, with inclusion rationale and no eligibility/usage assertions.
- Added an evidence ledger with authoritative public source URLs, access date, and documented-fact/inference/unknown labeling. Explicitly separated public service policy from API/project docs and marked unresolved obligations.
- Rechecked every initial gap. Evidence remains insufficient for selection; Slice B must verify all candidate requirements and resolve workload assumptions. No US default is permitted by this handoff.

## Scope and authorization

Only `docs/research/location-input-contract.md` is a slice deliverable. No code, provider integration, account creation/change, paid call, publication, secret, or real customer/operator data was introduced. The documentation preserves the first-release and P0/P1 focus and does not authorize future external side effects.

## Verification

- `git diff --check`: passed for tracked diff; new handoff was also reviewed for whitespace and all Slice A criteria (it was untracked at that point).
- `npm run check`: passed (typecheck, existing offline test, build).
- `mise exec -- npm run check`: passed (same full repository check under the project toolchain).
- No code tests were added: this slice changes only research documentation, as specified by its evidence-check RED/GREEN process.
- Markdown clean check: passed when writing `docs/research/location-input-contract.md`.

## Concerns / carry-forward

Provider terms, current plans/quotas, shared-service aggregate behavior, authentication, ambiguity/country specifics, attribution, storage, and data rights remain unresolved for every candidate. The workload and independent-operator credential model need owner confirmation. Research is not a provider recommendation and should be revalidated against current authoritative terms in Slice B.
