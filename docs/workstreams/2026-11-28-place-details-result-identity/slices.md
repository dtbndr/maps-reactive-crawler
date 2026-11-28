# Place Details and Result Identity Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Deliver useful, versioned synthetic place output that preserves discovery evidence and makes identity, geography, field availability, outstanding discovery gaps and detail attempt state independently legible, without executing detail requests.

## Scope
**Supported scenario:** bounded first-release operator-run discovery; one local checkpoint inspected via the existing read-only status/export path. Automated acceptance is synthetic and offline.

**In scope**
- Characterize mapped candidate observations, duplicates, provenance, partial/mixed-invalid/capped results, durable reopen and current export behavior.
- Carry currently available mapped candidate name and `place_id` (as candidate ID), optional coordinate and occurrence provenance without changing mapper acceptance.
- Add explicit v2 export selection and record fields/gap status while retaining exact v1 compatibility/default and old-checkpoint inspection.
- Connected synthetic acceptance for recovery, partial outcomes, deterministic export, grouping and read-only reopen; update operator documentation.

**Out of scope**
- Provider detail collection, request admission, URL locator synthesis, identity promotion, live demonstration, live identity/completeness/schema assumptions, calls, secrets, account changes or publication.
- Speculative fields such as phone/address, name/coordinate fuzzy matching, boundary filtering changes, schema changes solely to hold richer mapped values, or changes to provider mapper acceptance.
- Treating discovery absence, partial response, pending detail or unavailable fields as interchangeable states.

## Key files
- `src/bright-data-mapping.ts`: currently maps `name`, `place_id` and optional coordinate as discovery candidate; retains valid candidates on partial/mixed-invalid or capped results while setting gap/expansion outcome.
- `src/traversal.ts`: `CandidateObservation` stores ID/name/coordinate/classification/source and stable observation/attempt/occurrence IDs; `applyDiscoveryResult` controls per-occurrence persistence, verified fixture grouping and pending detail work.
- `src/durable-state.ts`: checkpoint validation and legacy compatibility, including snapshots with absent `detailWork` and old observations without `name`.
- `src/operator.ts`: v1 export currently includes ID/coordinate/classification/provenance, groups verified keys only, and separately outputs unverified observations; status has discovery/detail gaps and pending details.
- `src/cli.ts`: strict current `export --checkpoint PATH` parser and CLI serialization.
- `test/bright-data-mapping.test.mjs`, `test/traversal.test.mjs`, `test/durable-identity.test.mjs`, `test/durable-discovery.test.mjs`, `test/operator-inspection.test.mjs`, `test/operator-acceptance.test.mjs`: mapper, identity, recovery and connected operator acceptance.
- `README.md`, `docs/happy-path.md`, `docs/milestones/03-provider-integrations.md`: operator contract and workstream boundary.
- `docs/research/bright-data-mcp.md`, `docs/research/bounded-crawl-recovery.md`: provider evidence limits and synthetic recovery/gap rules.

## Architecture invariant
The first release's bounded discovery path remains the only execution path. Do not change acceptance of mapped results to rescue missing fields. Preserve raw occurrence multiplicity and its source cell, attempt, observation, occurrence ordinal, optional coordinate and classification. Candidate `place_id` is not verified identity; only explicit fixture-verified identity may group occurrences. Keep discovery gaps, field absence, geographic classification, and detail attempt/not-attempt status distinct. A pending detail record is not proof of failure or missing data; details cannot repair a discovery gap or coverage. Inspection stays read-only. Existing v1 document shape remains byte-for-byte/field-shape compatible and default-selected; v2 requires an explicit CLI/library choice. Do not silently migrate or reshape checkpoints.

## Assumptions and design decisions
- Discovery-first minimum useful observation is mapped name, candidate provider `place_id`, optional coordinate and source occurrence provenance. `src/bright-data-mapping.ts` currently retains the mapped name in its candidate, but normalization through durable traversal and export does not yet preserve/name it consistently. Test the actual seam before changing it.
- `id` in `CandidateObservation` / export is the observed candidate identifier. For provider-backed mappings it may be a provider `place_id`, but it is not thereby verified canonical identity. A nonempty candidate ID and an explicit `verifiedCanonicalKey` are separate concepts.
- Geography classification (`inside`, `outside`, `unverified`) is the existing per-observation result of coordinate reliability and configured area. Missing coordinates alone do not fail a crawl; do not apply new output filtering. A discovery gap reflects incomplete/failed/uncertain discovery, not geography or missing coordinates.
- Exact v2 projection: top level is `{version: 2, status: <unchanged OperatorStatus v1>, verifiedPlaces: [{canonicalKey, observations: [occurrence]}], unverifiedObservations: [occurrence]}`. Each occurrence has `candidateId`, `name` (string or null), `coordinate` (coordinate object or null), `classification`, `fieldStatus: {name, coordinate}` where each is `present` or `not_present` in the persisted observation, `detailState`, and the unchanged provenance fields `sourceCell`, `workId`, `attemptId`, `observationId`, `occurrence`. Field status describes stored observation only, not provider-side absence. `detailState` is one of `not_attempted` (pending detail work), `reserved`, `dispatched`, `uncertain`, `completed`, `skipped`, or `unknown` (legacy record has no associated detail metadata). Verified grouping retains all occurrence entries; unverified records are never grouped. Existing status v1 carries discovery-gap and detail-gap status separately and stays unchanged in v2.
- Export selection is `export --checkpoint PATH` → v1, unchanged; `export --checkpoint PATH --format v2` → v2. Library `exportResults({checkpoint})` remains v1 and `exportResults({checkpoint, format:'v2'})` selects v2. Reject unknown/repeated format flags. Do not add an implicit environment/configuration default.
- Existing durable checkpoint schema is version 1 and currently tolerates optional candidate name and optional/absent `detailWork`; export must be read-only and must not rewrite old checkpoints just to expose v2. V2 `fieldStatus` describes only whether the field was stored on that occurrence (`not_present` is not a claim that provider data is missing); absent detail metadata maps to `unknown`, while known pending detail work maps to `not_attempted`. Do not fabricate completion or failure. New status inference must not treat pending details as failure. Unsupported/corrupt checkpoints remain fail-closed as before.
- Preserve mapper behavior: currently invalid entries create incomplete/gap status; a capped response creates a gap and prevents expansion while retaining valid candidates. Do not make mapper accept records with absent `name` or `place_id` as a side effect of carrying candidate fields. Do not infer a URL locator from candidate ID or synthesize one to enable details.
- Defer details entirely: public catalog research describes URL-input `collect_by_url` and declared fields, but current URL-input catalog evidence and persisted records do not prove a runnable request contract/locator, runtime schema, identity mapping, response attribution, rights or completeness. Do not make detail requests or promote IDs. If later evidence supports details, request admission/recovery and response attribution/export are separate later-workstream contracts.
- Do not include speculative phone/address fields. Source research does not guarantee them; adding guesses or unsupported field promises creates needless contract surface.
- Keep P0/P1 priority evidence tied to safe and useful bounded first-release operator discovery. The output distinction addresses directly useful record/provenance and honest gaps without turning lower-priority enrichment into implementation. P-grade is impact, not authorization or an acceptance waiver.
- Two sequential slices are sufficient: A is characterization and preservation of existing discovery evidence; B is one cohesive output contract (versioned schema, selection, connected recovery/partial acceptance and docs) built on A. They share one identity/provenance/export contract and can be tested together. Split only if evidence shows independently unmanageable contracts; seek operator approval before changing scope/sizing.
- Before any future live demonstration, reassess GitHub issues #4 and #5 and applicable provider, rights and pricing evidence. No live demonstration is included here. A future paid call needs separate explicit approval after presenting an uncertain cost estimate, proposed work and stop limits; this brief does not authorize calls. Terms, account rights and pricing remain separate gates.

### Implementation discretion
Intentionally left to workstream-driven-development:
- Internal helper names, local types, SQL/JSON projection mechanics and test fixture values.
- Stable field names within the specified v2 distinctions only; ensure the v2 contract is captured in tests and documentation before implementation is considered complete.
- How to represent absent legacy metadata, so long as unknown versus observed absence, pending/not-attempted, and gaps remain distinguishable and v1 remains unchanged.
- Focused file organization and exact assertion decomposition; do not alter public behavior outside explicit v2 selection.

### Unresolved design blockers
None for the planned synthetic-only work. The brief itself still requires operator approval before execution. Provider detail contract, live schema/identity/completeness, account rights/pricing and any demonstration are not resolved here and are not blockers for this no-detail workstream; they remain separate future gates.

## Final verification
Run applicable project checks at workstream end and record exact command/results in the execution log. Do not make provider calls.
- [ ] Tests/build/type check: `mise exec -- npm run check`
- [ ] Diff hygiene: `git diff --check`
- [ ] Documentation review: confirm v1 default/v2 opt-in, field/gap distinctions, non-attempted detail and no live claims are consistent across `README.md` and `docs/happy-path.md`.

---

## Slices

### Slice A: Discovery observation characterization

**Goal**: Establish evidence-backed baseline and targeted synthetic coverage of the existing mapped discovery observation, partial outcomes, repeated occurrences, provenance and reopen behavior without changing public/export shape or checkpoint format.

#### Tasks

**`src/bright-data-mapping.ts`, `src/traversal.ts`, `src/durable-state.ts`, `src/operator.ts`; focused tests in `test/`**
- [ ] Inspect existing behavior and tests; add characterization assertions where needed for mapped name/place_id/optional coordinate, acceptable invalid/capped partial outcomes, duplicate raw occurrences, distinct source provenance, fixture-verified versus unverified identities, detail pending status, and reopening/inspecting preexisting v1 checkpoints. Run them before any behavior edit; capture exact baseline.
- [ ] Trace the name from mapping into `CandidateObservation`, SQLite checkpoint and v1 projection. Identify the narrowest point where richer mapped data is dropped; preserve the name only if the existing data path permits without altering checkpoint version or mapper acceptance. Do not add schema/version scaffolding speculatively.
- [ ] Exercise mixed valid/invalid and response-at-limit cases: retain accepted candidates and their occurrences, keep discovery gaps visible, preserve existing expansion decisions, and distinguish those gaps from pending detail. Exercise duplicate candidate IDs as distinct occurrences and verify no grouping absent explicit canonical identity.
- [ ] Use on-disk SQLite and fresh-process/reopen acceptance where current test harness supports it. Compare exact occurrence/provenance sets and gap/detail state before and after read-only reopen; assert no export/status mutation. Include legacy snapshots/checkpoints missing optional name or detailWork if constructible through current supported compatibility paths.
- [ ] Make only the minimum targeted discovery-observation change needed to meet the approved minimum useful observation. No output schema selection or v1 shape change in this slice. Do not change mapping acceptance, provider behavior, checkpoint version, details execution or identity rules.
- [ ] Run focused tests, build and `mise exec -- npm run check`; record exact commands and results. Fix regressions; commit only slice changes after verification.

#### Watch out
- A provider `place_id` is an unverified candidate ID. Do not elevate it to canonical identity because repeated values match.
- Missing coordinates remain retained/unverified by existing rules, not a failed crawl. Details do not fill coverage gaps.
- Pending detail is not a detail failure nor proof fields are absent. Preserve every source occurrence.

#### Verification
- `mise exec -- npm run build`
- `mise exec -- node --test test/bright-data-mapping.test.mjs test/traversal.test.mjs test/durable-identity.test.mjs test/durable-discovery.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs`
- `mise exec -- npm run check`
- Assert exact occurrence count and provenance, verified-only grouping, failure/partial/capped gap distinction, unchanged mapper acceptance and unchanged v1 output shape. Include fresh-process or existing equivalent checkpoint reopen evidence; no live demonstration.

#### Carry-forward
A characterized, minimally complete persisted discovery observation and repeatable synthetic recovery/partial baseline. V1 export contract remains unchanged; v2 projection and explicit selection are Slice B.

### Slice B: Explicit v2 export and connected synthetic acceptance

**Goal**: Add additive v2 export with an explicit opt-in while retaining exact v1 default/compatibility, and prove deterministic connected records/gaps across synthetic recovery, partial outcomes and read-only reopen.

#### Tasks

**`src/operator.ts`, `src/cli.ts`, `test/operator-inspection.test.mjs`, `test/operator-acceptance.test.mjs`, related focused export tests, `README.md`, `docs/happy-path.md`**
- [ ] Establish meaningful RED for explicit v2 format selection, v2 projection distinctions, old checkpoint projection and invariance of the v1 default before implementation. Test CLI parsing rejects unsupported/duplicate format selections without checkpoint mutation.
- [ ] Define and test the v2 shape from the settled decisions: one entry per raw occurrence; available name and candidate `place_id`/ID; optional coordinate and geographical classification; verified identity grouping only when fixture identity is explicitly verified; provenance; separately visible discovery gaps, missing stored fields and detail attempted/not-attempted state. Null/missing data and pending detail must not be converted into provider failure, field-missing claims, completion or verified identity.
- [ ] Add `--format v2` as the only CLI opt-in; no option and library call without format continue to emit exact v1. Keep v1 top-level and nested field shape unchanged. Reject invalid or repeated format selections. No checkpoint format/version bump for output-only projection; ensure old supported v1 checkpoints remain read-only exportable and absence of optional legacy fields is represented honestly in v2.
- [ ] Test deterministic ordering and exact results across a fresh-process start, a cap-limited partial state, recovery/reopen and resume. Include repeated occurrences from distinct source cells, duplicate unverified candidate IDs, explicitly verified synthetic duplicate identity, valid observation mixed with invalid/capped partial outcome, missing coordinate and pending detail not attempted. Verify source provenance survives grouping and each occurrence remains present.
- [ ] Assert v2 separates discovery gap from classification and field status; pending detail neither produces a failure nor marks all fields missing. Assert missing coordinates alone do not fail traversal and detail never repairs discovery/coverage gaps. Preserve current expansion decisions and mapper acceptance.
- [ ] Assert status/export remain read-only on legacy/current checkpoints and that neither format mutates or migrates checkpoint state. Verify unsupported/corrupt checkpoints still fail closed. Compare exact v1 document before/after implementation for identical fixture state.
- [ ] Update `README.md` and `docs/happy-path.md` with exact default/opt-in usage, v1 compatibility, v2 available-field/gap semantics, unverified candidate IDs, explicit identity grouping limits, detail-not-attempted meaning and non-exhaustive coverage. Do not imply details run or add phone/address promises.
- [ ] Reassess `docs/milestones/03-provider-integrations.md` Workstream 2 framing so this plan's synthetic output work is not described as detail execution. Keep future detail request admission/recovery separate from response attribution/export; document no live demonstration in acceptance. Before any later live demonstration reassess GitHub #4 and #5 and applicable contract, rights and pricing evidence.
- [ ] Run focused checks and full `mise exec -- npm run check`, `git diff --check`, and final documentation consistency review; record actual results. Commit only slice changes after required checks pass. No live/provider actions.

#### Watch out
- V2 is additive output schema, not a provider contract or a persisted checkpoint schema migration.
- Old checkpoints may lack stored names or explicit detail-work fields. Do not fabricate values or backfill/mutate during read-only export. Distinguish unknown legacy detail metadata from known detail attempt state.
- The direct-provider catalog evidence found location discovery URL output and a separate URL-input detail method, but not a runnable collection contract for persisted records. Do not synthesize locators or promote candidate identity.
- No live demonstration is acceptance. Terms, account rights and pricing are separate approval/evidence gates; calls, account changes and publication are prohibited here.

#### Verification
- `mise exec -- npm run build`
- `mise exec -- node --test test/operator-inspection.test.mjs test/operator-acceptance.test.mjs test/operator-cli.test.mjs test/bright-data-mapping.test.mjs test/durable-identity.test.mjs`
- `mise exec -- npm run check`
- `git diff --check`
- Assert exact v1 compatibility/default, explicit v2 opt-in and parser rejection; deterministic fresh-process partial/recovery export; verified fixture grouping with complete provenance; repeated unverified occurrences not grouped; distinct discovery gaps, missing-field reporting, classification and detail status; read-only old-checkpoint reopen; no provider requests or live demonstration.
