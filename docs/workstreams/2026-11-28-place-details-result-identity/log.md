# Place Details and Result Identity Workstream Log

Opt-ins: playback=on, external review=on
Isolation: branch — branch ws/place-details-result-identity
Pre-flight: clean

## Slice C implementation evidence

Base: `a954d7a`. This record distinguishes the original implementation session from its follow-up; wall-clock timestamps were not captured and are not reconstructed. Durations below are test-runner durations, not wall-clock timestamps. No paid or live provider calls were made.

1. **Before API/CLI edits:** the existing standalone v1 type fixture was retained unchanged and the following exact command passed:
   `mise exec -- npm run build && mise exec -- ./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --types node --skipLibCheck test/types/operator-export-v1-default.test.ts`
2. **Before API/CLI edits, after adding runtime tests:** `mise exec -- npm run build && mise exec -- node --test test/operator-cli.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs` built successfully, then produced the intended RED: 23 passed, 2 failed (1104.326875 ms). The exact v1 library document and CLI JSON baseline test passed; unknown and repeated format rejection assertions were reached and passed before the valid CLI assertion. Excerpts:
   - `explicit v2 library and CLI export select the internal projection`: `AssertionError ... 1 !== 2` (actual version 1, expected 2).
   - `CLI accepts explicit v2 export and rejects unknown and repeated formats`: `AssertionError ... 1 !== 0` (valid v2 CLI exit status 1, expected 0).
   These were assertions, not loader, stale-dist or build failures. No pre-existing focused test failed.
3. **After initial implementation:** the first build exposed a TypeScript discriminated-union narrowing error in `src/cli.ts` (`Property 'format' does not exist`); splitting the status/cancel union fixed it. Fresh build and focused tests then passed 25/25. Typecheck, exact public consumer type command (now also asserting v2 version literal 2), connected suite (28/28), and full check (488/488 at that stage) passed. The initial worker explicitly reported incomplete acceptance and made no commit.
4. **Follow-up acceptance additions:** a first run of `mise exec -- node --test test/operator-acceptance.test.mjs test/operator-v2-projection.test.mjs` after a fresh build had 16/17 pass; the new legacy test incorrectly retained a completed-work submission counter after removing detail metadata. Resetting that test counter yielded 17/17. The mixed/at-cap partial test then passed 2/2 after adding read-only inspection and no-replay resume assertions. These are test-setup failures, not the pre-implementation RED above.
5. **Validation before adding the inline case, in order:**
   - `mise exec -- npm run build && mise exec -- node --test test/operator-cli.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs`: pass, 25/25 (1153.942375 ms).
   - `mise exec -- npm run typecheck`: pass.
   - `mise exec -- npm run build && mise exec -- ./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --types node --skipLibCheck test/types/operator-export-v1-default.test.ts`: pass.
   - `mise exec -- npm run build && mise exec -- node --test test/synthetic-bright-data-operator.test.mjs test/durable-bright-data-partial.test.mjs test/bright-data-mapping.test.mjs test/durable-identity.test.mjs`: pass, 28/28 (123.565458 ms).
   - `mise exec -- npm run build && mise exec -- npm run check`: pass, 489/489 (7671.305584 ms), typecheck and final build included.
   - `git diff --check`: pass. Documentation consistency reviewed against v1 default, v2 stored-field projection, identity and coverage limits; no detail execution or live acceptance claimed.

Fresh-process fixture CLI tests cover selection, provenance, absent names and recovery; injected provider tests cover names, local-limit resume, per-input cap and mixed-error partial checkpoints, status/export, no replay and no reopening after raising limits. Public projection tests cover representative grouped and unverified detail states, legacy unknown, corruption rejection and read-only inspection. The pre-existing projection suite remains authoritative for the complete field/status matrix and gap overlap. Synthetic tests establish neither live provider behavior nor provider identity.

6. **Inline provider addition and final rerun:** added a name-bearing inline submission with status/export and resume no-replay assertions; `mise exec -- node --test test/synthetic-bright-data-operator.test.mjs` passed 4/4. Then repeated, in order, `mise exec -- npm run build && mise exec -- node --test test/operator-cli.test.mjs test/operator-inspection.test.mjs test/operator-acceptance.test.mjs` (25/25, 1189.576709 ms); `mise exec -- npm run typecheck` (pass); `mise exec -- npm run build && mise exec -- ./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --types node --skipLibCheck test/types/operator-export-v1-default.test.ts` (pass); `mise exec -- npm run build && mise exec -- node --test test/synthetic-bright-data-operator.test.mjs test/durable-bright-data-partial.test.mjs test/bright-data-mapping.test.mjs test/durable-identity.test.mjs` (29/29, 129.003542 ms); `mise exec -- npm run build && mise exec -- npm run check` (490/490, 8077.911416 ms); and `git diff --check` (pass).
