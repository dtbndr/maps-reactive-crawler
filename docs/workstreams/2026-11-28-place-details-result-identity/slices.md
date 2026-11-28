# Place Details and Result Identity Workstream Slices

Agent-facing. The operator does not need to read this file.

## Objective
Deliver useful, versioned synthetic place output that preserves discovery evidence and makes identity, geography, field availability, discovery gaps and detail-work state independently legible, without executing detail requests.

## Scope
**Supported scenario:** bounded first-release operator-run discovery; one local checkpoint inspected through the existing read-only status/export path. Automated acceptance is synthetic and offline.

**In scope**
- Characterize existing mapped observations, duplicate occurrences, provenance, partial/mixed-invalid/capped results, durable reopen/resume, current v1 output, and the injected direct-provider path.
- Preserve mapped candidate name, `place_id` as an unverified candidate ID, optional coordinate and occurrence provenance without changing mapper acceptance or checkpoint version.
- Add an internal v2 projection, then separately expose it through explicit library/CLI selection while retaining exact v1 compatibility/default and old-checkpoint inspection.
- Connected synthetic acceptance for recovery, partial outcomes, deterministic export, grouping and read-only reopen; update operator documentation.

**Out of scope**
- Provider detail collection, request admission, URL locator synthesis, identity promotion, live demonstration, live identity/completeness/schema assumptions, calls, secrets, account changes or publication.
- Speculative fields such as phone/address, name/coordinate fuzzy matching, boundary filtering changes, schema changes solely to hold richer mapped values, or changes to provider mapper acceptance.
- Treating discovery absence, partial response, pending detail or unavailable stored fields as interchangeable states.

## Key files
- `src/bright-data-mapping.ts`: maps `name`, `place_id` and optional coordinate; partial/mixed-invalid or capped responses retain valid candidates while setting gap/expansion outcome.
- `src/durable-bright-data-submission.ts`: inline and retrieved direct-provider branches pass mapped name into traversal.
- `src/traversal.ts`: `CandidateObservation` stores ID/name/coordinate/classification/source and stable observation/attempt/occurrence IDs; `applyDiscoveryResult` controls per-occurrence persistence, verified fixture grouping and pending detail work.
- `src/durable-state.ts`: checkpoint validation and legacy compatibility, including snapshots with absent `detailWork` and observations without optional `name`.
- `src/operator.ts`: v1 export omits name, groups verified keys only, and separately outputs unverified observations; status projects discovery/detail gaps and pending details.
- `src/cli.ts`: strict current `export --checkpoint PATH` parser and CLI serialization.
- `test/synthetic-bright-data-operator.test.mjs`: injected-transport direct-provider/operator acceptance, including inline and retrieved results.
- `test/durable-bright-data-partial.test.mjs`: durable direct-provider partial/reopen/resume behavior.
- `test/bright-data-mapping.test.mjs`, `test/traversal.test.mjs`, `test/durable-identity.test.mjs`, `test/durable-discovery.test.mjs`, `test/operator-inspection.test.mjs`, `test/operator-acceptance.test.mjs`, `test/operator-cli.test.mjs`: mapper, identity, recovery, export and connected CLI acceptance.
- `README.md`, `docs/happy-path.md`, `docs/milestones/03-provider-integrations.md`: operator contract and workstream boundary.
- `docs/research/bright-data-mcp.md`, `docs/research/bounded-crawl-recovery.md`: provider evidence limits and synthetic recovery/gap rules.

## Architecture invariant
The first release's bounded discovery path remains the only execution path. Do not change acceptance of mapped results to rescue missing fields. Preserve raw occurrence multiplicity and its source cell, attempt, observation, occurrence ordinal, optional coordinate and classification. Candidate `place_id` is not verified identity; only explicit fixture-verified identity may group occurrences. Keep stored field availability, geographic classification, discovery/detail gaps and detail-work state legible as separate concepts. Preserve the existing `OperatorStatus` projection without claiming its gap arrays are disjoint: `discoveryGaps` includes all traversal gaps, including `detail-origin:*` blockers that can also be represented in `detailGaps`. A pending detail work item is not proof of failure or missing provider data; details cannot repair a discovery gap or coverage. Inspection stays read-only. Existing v1 document and CLI JSON bytes remain exact and default-selected; v2 requires explicit selection only after its complete internal projection contract is implemented. Do not silently migrate or reshape checkpoints.

## Assumptions and design decisions
- Discovery-first minimum useful observation is mapped name, candidate provider `place_id`, optional coordinate and source occurrence provenance. Current direct-provider paths pass names into traversal and durable observations; v1 export intentionally omits name. Do not presume a persistence defect. Slice A is characterization-only unless evidence demonstrates a loss, and any correction requires a failing test before the fix.
- `CandidateObservation.id` is the observed candidate identifier. For provider-backed mappings it may be a provider `place_id`, but it is not thereby verified canonical identity. A nonempty candidate ID and an explicit `verifiedCanonicalKey` are separate concepts.
- Geography classification (`inside`, `outside`, `unverified`) is the existing per-observation result of coordinate reliability and configured area. A null/missing coordinate is `not_present` in v2 field status and remains retained/unverified by existing rules; missing coordinates alone do not fail a crawl. A discovery gap reflects incomplete/failed/uncertain discovery, not geography or missing coordinates.
- Exact v2 output: `{version: 2, status: <unchanged OperatorStatus v1>, verifiedPlaces: [{canonicalKey, observations: [occurrence]}], unverifiedObservations: [occurrence]}`. Each `occurrence` has exactly these fields: `candidateId` (the persisted candidate ID), `name` (string or null), `coordinate` (coordinate object or null), `classification`, `fieldStatus: {name, coordinate}` (each value is exactly `present` or `not_present` based on persisted observation value; null is `not_present`), `detailState`, and provenance `sourceCell`, `workId`, `attemptId`, `observationId`, `occurrence`. Field status describes stored observation only, not provider-side absence. Do not add optional speculative fields or vary these names.
- Detail association is by each occurrence's `observationId` membership in exactly one persisted `DetailWork.observationIds` list. Never join by candidate ID, canonical key, gaps, `pendingDetails`, or latest attempt. Project that associated persisted work's status: `pending` → `not_attempted`; `reserved`, `dispatched`, `uncertain`, `completed`, and `skipped` pass through unchanged. If the legacy checkpoint has no `detailWork` property, project `unknown`. If `detailWork` is present but association is missing or duplicated, treat the checkpoint as corrupt and fail closed through existing validation; do not downgrade it to `unknown`. A shared verified work item can cover multiple occurrences: `completed` is the shared work's status, not proof a detail request was made for every occurrence individually. Duplicate unverified candidate IDs remain separate observations and get state only through their distinct observation IDs.
- V2 ordering is fixed to v1's existing ordering: `verifiedPlaces` sorted lexically by `canonicalKey`; each group's `observations` sorted lexically by `observationId`; `unverifiedObservations` sorted lexically by `observationId`. No alternate deterministic ordering is acceptable.
- Preserve exact existing `OperatorStatus` in v2. `discoveryGaps` maps all traversal gaps, including `detail-origin:*` blockers; such a blocker can overlap a related detail gap. Preserve and test that inherited behavior rather than filtering or claiming disjoint gap lists.
- Export selection after Slice C is `export --checkpoint PATH` → exact v1; `export --checkpoint PATH --format v2` → exact v2. Library `exportResults({checkpoint})` remains exact v1 and `exportResults({checkpoint, format:'v2'})` selects v2. Reject unknown/repeated format flags. No implicit environment/configuration default. The v2 internal projection in Slice B is not exposed through the package public API or CLI; no partial public v2 contract before Slice C.
- Existing durable checkpoint schema is version 1 and tolerates optional candidate name and optional/absent `detailWork`; export must be read-only and must not rewrite old checkpoints just to expose v2. Old observations without name project `name:null` and `fieldStatus.name:'not_present'`, which describes stored shape only. Legacy absent detail metadata maps to `unknown`; known pending work maps to `not_attempted`. Do not fabricate completion or failure. Unsupported/corrupt checkpoints remain fail-closed as before.
- Preserve mapper behavior: currently invalid entries create incomplete/gap status; response at its per-input cap creates a gap and suppresses expansion while retaining valid candidates. Distinguish that provider response cap from a local work-limit stop; do not change either behavior, imply a local stop is a provider cap, or imply raising a limit reopens a partial cell. Resume must not replay completed work. Do not make mapper accept records with absent `name` or `place_id` as a side effect of carrying candidate fields.
- Defer details entirely: public catalog research describes URL-input `collect_by_url` and declared fields, but current URL-input catalog evidence and persisted records do not prove a runnable request contract/locator, runtime schema, identity mapping, response attribution, rights or completeness. Do not make detail requests or promote IDs. If later evidence supports details, request admission/recovery and response attribution/export are separate later-workstream contracts.
- Do not include speculative phone/address fields. Source research does not guarantee them; adding guesses or unsupported field promises creates needless contract surface.
- Keep P0/P1 priority evidence tied to safe and useful bounded first-release operator discovery. The output distinction addresses directly useful record/provenance and honest status without turning lower-priority enrichment into implementation. P-grade is impact, not authorization or an acceptance waiver.
- Three sequential slices are warranted: A establishes direct-discovery and recovery evidence; B defines and tests one internal projection independent of exposure; C separately wires CLI/library selection, v1 compatibility, connected acceptance and docs. B and C have independent test boundaries: schema/association/legacy/order projection can be tested from checkpoints, while API selection/parser/rejection/default and connected entry-point behavior can be tested separately. C does not publicly expose an incomplete B contract. This is the smallest split that addresses distinct failure modes; no scope is added.
- Before any future live demonstration, reassess GitHub issues #4 and #5 and applicable provider, rights and pricing evidence. No live demonstration is included here. A future paid call needs separate explicit approval after presenting an uncertain cost estimate, proposed work and stop limits; this brief does not authorize calls. Terms, account rights and pricing remain separate gates.

### Implementation discretion
Intentionally left to workstream-driven-development:
- Internal helper/module naming and SQL/JSON projection mechanics, provided B's projection remains internal and C is the first public exposure.
- Synthetic fixture values and focused assertion decomposition, without changing the exact field names, values, associations, status semantics or ordering specified above.
- Focused file organization; do not alter public behavior outside explicit v2 selection in Slice C.

### Unresolved design blockers
None for the planned synthetic-only work. The brief itself still requires operator approval before implementation. Provider detail contract, live schema/identity/completeness, account rights/pricing and any demonstration are not resolved here and are not blockers for this no-detail workstream; they remain separate future gates.

## Final verification
Run applicable project checks at workstream end and record exact command/results in the execution log. Do not make provider calls.
- [ ] Tests/build/type check: `mise exec -- npm run check`
- [ ] Diff hygiene: `git diff --check`
- [ ] Documentation review: confirm v1 default/v2 opt-in, field/gap distinctions, non-attempted detail and no live claims are consistent across `README.md` and `docs/happy-path.md`.

---

## Slices

### Slice A: Direct discovery and durable partial characterization

**Goal**: Establish evidence-backed baseline for mapped direct-provider observations, partial outcomes, repeated occurrences, provenance and reopen/resume without changing output shape, checkpoint format or runtime behavior.

#### Tasks

**`src/bright-data-mapping.ts`, `src/durable-bright-data-submission.ts`, `src/traversal.ts`, `src/durable-state.ts`, `src/operator.ts`; `test/synthetic-bright-data-operator.test.mjs`, `test/durable-bright-data-partial.test.mjs`, focused tests in `test/`**
- [ ] Inspect existing behavior and tests. Explicitly exercise injected-transport `test/synthetic-bright-data-operator.test.mjs` and `test/durable-bright-data-partial.test.mjs`; characterize both inline and retrieved direct-provider results passing name into traversal and durable observations. Record that current v1 projection omits name without assuming it was dropped from persistence.
- [ ] Before edits, capture a passing pre-change v1 baseline for the same stable checkpoint: exact library `exportResults` document including return type and exact CLI JSON bytes. Keep the baseline fixture/assertion for comparison through C. Record pre-existing failing tests separately; never use v1 regression expectations as a RED test.
- [ ] Characterize candidate name/place_id/optional coordinate, valid mixed with invalid candidates, duplicate raw occurrences, distinct source provenance, verified versus unverified identities, pending detail work, and preexisting checkpoints with optional name or absent `detailWork`. A remains characterization-only unless a test demonstrates actual data loss; any proposed correction requires a failing test first and must not alter mapper acceptance or checkpoint version.
- [ ] In the injected direct-provider tests, distinguish a response at its per-input cap (retained valid results, gap and expansion suppressed) from a local work-limit stop. Assert existing behavior without treating a cap and local stop as equivalent or implying a raised limit reopens a partial cell.
- [ ] Use on-disk SQLite and fresh-process/reopen/resume acceptance where current harness supports it. Assert accepted occurrences, names, provenance and gaps survive read-only reopen and supported resume without replaying completed work; do not export/status-mutate or reopen a partial cell merely because a limit is raised.
- [ ] Run `mise exec -- npm run build` before focused tests so dist-importing tests use fresh output; run the stated focused tests, then run `mise exec -- npm run build` immediately before `mise exec -- npm run check` because `check` runs tests before its build step. Record exact commands/results. Make no behavior edits absent a demonstrated loss and approved scope. Commit only slice changes after verification.

#### Watch out
- A provider `place_id` is an unverified candidate ID. Do not elevate it to canonical identity because repeated values match.
- Missing coordinates remain retained/unverified by existing rules, not a failed crawl. Details do not fill coverage gaps.
- Pending detail is not a detail failure nor proof fields are absent. Preserve every source occurrence.

#### Verification (run in this order)
- `mise exec -- npm run build`
- `mise exec -- node --test test/synthetic-bright-data-operator.test.mjs test/durable-bright-data-partial.test.mjs test/bright-data-mapping.test.mjs test/traversal.test.mjs test/durable-identity.test.mjs test/durable-discovery.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs`
- `mise exec -- npm run build` (fresh dist immediately before full check; `check` runs tests before build)
- `mise exec -- npm run check`
- Assert passing exact v1 library document/return type and CLI JSON bytes as the pre-change baseline; direct name persistence; exact occurrence/provenance; verified-only grouping; invalid/partial/capped gap distinction; cap versus local stop; reopen/resume without replay; unchanged mapper acceptance and no live demonstration.

#### Carry-forward
A passing exact v1 baseline and characterized direct-discovery evidence across partial outcomes and durable reopen/resume. No output/API/checkpoint behavior changes. B can project v2 internally from this persisted state.

### Slice B: Internal v2 projection contract

**Goal**: Implement and independently verify the complete v2 projection against checkpoints without exposing it through the library public API or CLI.

#### Tasks

**`src/operator-v2-projection-internal.ts`; `test/operator-v2-projection.test.mjs` importing `../dist/operator-v2-projection-internal.js`**
- [ ] Create the internal source module and callable projection seam first, without exporting it from `src/index.ts`, `exportResults`, or CLI. Add the concrete test entry point `test/operator-v2-projection.test.mjs` importing the compiled internal module. This is a package-internal seam for focused tests only; keep the v1 path untouched.
- [ ] Before the initial RED, run `mise exec -- npm run build` so the test imports a fresh `dist/operator-v2-projection-internal.js`. Then run `mise exec -- node --test test/operator-v2-projection.test.mjs`. Require the failures to be assertion failures for intended missing v2 projection behavior; missing module/import, test-loader, or stale-dist failures are setup errors, not RED evidence, and must be fixed before interpreting test results.
- [ ] Establish meaningful RED assertions for new internal projection behavior only: field names, null/present semantics, classification, provenance, identity placement, work association, legacy handling, gap behavior and exact ordering from the contract above. Do not claim RED for unchanged v1 compatibility; use Slice A's passing exact baseline.
- [ ] Test name and candidate ID from direct synthetic observations, optional/null coordinate (`fieldStatus.coordinate:'not_present'`), name null (`fieldStatus.name:'not_present'`), and available values marked `present`. Field status describes checkpoint content, never provider-side absence.
- [ ] For every occurrence, associate `detailState` through its `observationId` in the unique `DetailWork.observationIds` membership and project that work's status only. Test all six persisted work statuses; assert `pending` → `not_attempted`, and pass `reserved`, `dispatched`, `uncertain`, `completed`, `skipped` unchanged. Prohibit joins by candidate ID/canonical key/gaps/pendingDetails/attempt.
- [ ] Test a verified group sharing one work item, including an observation appended to existing work: each member projects the shared persisted status, but `completed` must not claim each occurrence individually received a detail request. Test duplicate unverified candidate IDs remain separate and get status by their distinct observation IDs.
- [ ] Test legacy checkpoint with `detailWork` absent → `unknown`; when `detailWork` is present, missing or duplicate observation membership must fail closed through existing validator rather than become `unknown`. Do not weaken validator or synthesize association. Verify read-only projection and corrupt/unsupported checkpoint rejection.
- [ ] Preserve exact `OperatorStatus`, including all traversal gaps in `discoveryGaps` and possible overlap between a `detail-origin:*` blocker there and its related `detailGaps` entry. Test inherited overlap; do not promise disjoint arrays or filter blockers.
- [ ] Test exact v2 ordering: verified groups lexically by canonical key; group occurrences lexically by observation ID; unverified occurrences lexically by observation ID. Test repeated calls produce the same full document.
- [ ] Implement the complete projection until the focused assertions pass. Run a fresh `mise exec -- npm run build` after implementation and before the focused test command; then run `mise exec -- node --test test/operator-v2-projection.test.mjs`. Immediately before full validation, run `mise exec -- npm run build` again, then `mise exec -- npm run check` (its test phase precedes build) and `git diff --check`; record exact commands/results and commit only slice changes after verification. No API/CLI exposure or operator-doc claim for v2 yet.

#### Watch out
- No public or CLI v2 switch until Slice C; a partial projection is not an accepted user-facing feature.
- Old checkpoints without `detailWork` yield `unknown`, but present invalid membership is corruption and must fail closed.
- Shared verified detail work status is work-level, not per-occurrence evidence of requests.

#### Verification (run in this order)
- `mise exec -- npm run build` before the initial RED; then `mise exec -- node --test test/operator-v2-projection.test.mjs`. Confirm RED consists of projection assertions, not a missing `dist` module or loader/setup error.
- After implementation: `mise exec -- npm run build`, then `mise exec -- node --test test/operator-v2-projection.test.mjs`.
- Fresh full validation: `mise exec -- npm run build`, `mise exec -- npm run check`, `git diff --check` (build first because `check` tests before rebuilding).
- Assert the exact v2 fields/statuses/joins/order/gap overlap, old absent metadata, fail-closed malformed membership, read-only behavior, and that the projection is absent from public exports/CLI while v1 baseline remains untouched.

#### Carry-forward
A complete, tested internal projection with explicit schema, ordering and status association. No public v2 API, CLI, or operator-facing docs are available before C.

### Slice C: Explicit v2 opt-in, compatibility and connected acceptance

**Goal**: Expose the completed v2 projection only through explicit library/CLI opt-in, preserve exact v1 output by default, and verify connected synthetic results through durable partial recovery and read-only inspection.

#### Tasks

**`src/operator.ts`, `src/cli.ts`, `test/operator-inspection.test.mjs`, `test/operator-acceptance.test.mjs`, `test/operator-cli.test.mjs`, `test/synthetic-bright-data-operator.test.mjs`, `test/durable-bright-data-partial.test.mjs`, `test/types/operator-export-v1-default.test.ts`, `README.md`, `docs/happy-path.md`, `docs/milestones/03-provider-integrations.md`**
- [ ] Before changing library or CLI implementation, capture/verify Slice A's exact passing v1 baseline (full library document including return type and exact CLI JSON bytes). Add v2 library/CLI behavior tests and the compile-time fixture first; leave implementation untouched.
- [ ] Add runtime RED assertions for new v2 opt-in and rejection behavior, while running the existing v1 assertions against the same checkpoint and requiring them to pass. Run a fresh `mise exec -- npm run build` before the focused test command because those tests import `dist`. The intended RED must be assertion failures for absent v2 behavior, never missing/stale `dist`, import, or loader errors; repair setup errors before interpreting RED. Record pre-existing failures separately.
- [ ] Add compile-time fixture `test/types/operator-export-v1-default.test.ts`, importing `exportResults` and `OperatorExport` from the public package specifier `maps-reactive-crawler`; assert `exportResults({checkpoint:'compile-time-only'})` has exactly type `OperatorExport`. This separate consumer typecheck is required because `.mjs` runtime tests do not prove return-type compatibility and project `tsconfig.json` includes `src/**/*.ts` only.
- [ ] Run the following exact command after adding the fixture but before API/CLI edits, then repeat it after implementation; it builds the public `dist/index.d.ts` and compiles the assertion through the package's public `exports.types` entry:
  `mise exec -- npm run build && mise exec -- ./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --types node --skipLibCheck test/types/operator-export-v1-default.test.ts`
- [ ] Before API/CLI implementation, run the new focused runtime tests with a fresh build: `mise exec -- npm run build && mise exec -- node --test test/operator-cli.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs`. Require the v1 baseline assertions to pass and intended new v2 selection/rejection assertions to fail; any loader/import/dist failure is setup failure, not RED.
- [ ] Only after the intended runtime RED and passing pre-change v1/type baselines, add library option `exportResults({checkpoint, format:'v2'})` and CLI `export --checkpoint PATH --format v2`; keep no-option library/CLI exact v1. Unknown/repeated format flags fail without checkpoint mutation. This is first public/CLI exposure of v2, only after B's projection is complete.
- [ ] After API/CLI implementation run fresh build plus focused runtime tests: `mise exec -- npm run build && mise exec -- node --test test/operator-cli.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs`; then repeat the exact compile-time command above. Confirm v1 assertions/type assertion still pass and new v2 behavior now passes before full validation.
- [ ] Exercise fixture-backed fresh-process CLI status/export and format selection plus connected synthetic operator acceptance. Include injected synthetic Bright Data inline/retrieved results and durable partial behavior, then checkpoint close/reopen/resume. Assert accepted occurrences, names, provenance and gaps persist and completed work is not replayed; cap-limited cell remains partial as before and is not reopened just by raising limits.
- [ ] Exercise representative public equivalence to B's internal contract, not its full projection matrix: one verified group and one unverified occurrence with representative persisted detail states, plus public legacy-absent-metadata (`unknown`) and present malformed-association fail-closed cases. B remains authoritative for all projection fields, statuses, ordering, membership and overlap tests; do not duplicate its full matrix in C.
- [ ] Test CLI and library format selection/rejection, exact v1 compatibility, and connected recovery: response at per-input cap versus local work-limit stop, mixed valid/invalid partial results, durable close/reopen/resume without replaying completed work, no raised-limit reopening of a partial cell, read-only behavior, and no provider detail request. Verify representative public v2 output matches B's internal projection for the same checkpoint.
- [ ] Update `README.md` and `docs/happy-path.md` with exact default/opt-in usage, v1 compatibility, stored-field semantics, unverified candidate IDs, explicit identity grouping limits, detail-state mapping, legacy unknown state, inherited gap overlap and non-exhaustive coverage. Do not imply details run or add phone/address promises.
- [ ] Reassess `docs/milestones/03-provider-integrations.md` Workstream 2 framing so this synthetic output work is not described as detail execution. Keep future detail request admission/recovery separate from response attribution/export; state no live demonstration in acceptance. Before any later live demonstration reassess GitHub #4 and #5 and applicable contract, rights and pricing evidence.
- [ ] Run `mise exec -- npm run build` before dist-importing focused tests. Before full `mise exec -- npm run check`, run `mise exec -- npm run build` again because `check` runs tests before build; then run `git diff --check` and final docs consistency review. Record actual results. Commit only slice changes after required checks pass. No live/provider actions.

#### Watch out
- V2 is additive output, not a provider contract or checkpoint schema migration.
- `detailState` describes its associated persisted work item, not proof of per-occurrence request execution; legacy absence is `unknown`, not a fabricated state.
- Existing `discoveryGaps` may include `detail-origin:*` blockers also represented in `detailGaps`; preserve this and do not promise disjoint gap lists.
- The direct-provider catalog evidence found location discovery URL output and a separate URL-input detail method, but not a runnable collection contract for persisted records. Do not synthesize locators or promote candidate identity.
- No live demonstration is acceptance. Terms, account rights and pricing are separate approval/evidence gates; calls, account changes and publication are prohibited here.

#### Verification (run in this order)
- Add CLI/library v2 tests and `test/types/operator-export-v1-default.test.ts` before changing API/CLI implementation.
- Pre-change compile-time compatibility: `mise exec -- npm run build && mise exec -- ./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --types node --skipLibCheck test/types/operator-export-v1-default.test.ts` (must pass).
- Pre-change runtime RED with v1 assertions passing: `mise exec -- npm run build && mise exec -- node --test test/operator-cli.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs` (new v2 behavior assertions fail; v1 baseline passes).
- After implementation, rerun fresh-build focused runtime tests: `mise exec -- npm run build && mise exec -- node --test test/operator-cli.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs`.
- After implementation, rerun the exact pre-change compile-time command above; public no-option call must still type as exactly `OperatorExport`.
- Connected dist-importing tests: `mise exec -- npm run build && mise exec -- node --test test/synthetic-bright-data-operator.test.mjs test/durable-bright-data-partial.test.mjs test/bright-data-mapping.test.mjs test/durable-identity.test.mjs`.
- Fresh full validation: `mise exec -- npm run build`, `mise exec -- npm run check`, `git diff --check` (build first because `check` tests before rebuilding).
- Assert exact v1 library/CLI baseline/default, explicit v2-only opt-in and parser rejection; deterministic fresh-process partial/recovery export; verified fixture grouping with complete provenance; repeated unverified occurrences not grouped; observationId detail association/status mapping; distinct stored-field status/classification with inherited gap overlap; read-only old-checkpoint reopen/resume without replay; no provider detail request or live demonstration.
