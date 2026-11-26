# Slice A4 report

## Scope
Single-operator synthetic fixture validation only. No live provider, paid calls, publishing, account changes, place filtering, or added filesystem/concurrency guarantees.

## RED (before production changes)

Command: `mise exec -- npm run build`
Result: exit 0 (`tsc` passed).

Command: `mise exec -- node --test test/operator-fixture.test.mjs`
Result: exit 1; 18 tests, 11 passed, 7 failed. These were behavioral assertion failures, not setup or import errors:

- `rejects verified candidate key ""`: `AssertionError [ERR_ASSERTION]: Missing expected exception.` at the expected `/Invalid verified candidate key/` rejection assertion.
- `rejects verified candidate key "  "`: same missing-exception assertion.
- `rejects verified candidate key "\t\n"`: same missing-exception assertion.
- `rejects candidate coordinate with latitude below minimum`: missing exception at the expected `/Invalid candidate coordinate/` assertion.
- `rejects candidate coordinate with latitude above maximum`: same missing-exception assertion.
- `rejects candidate coordinate with longitude below minimum`: same missing-exception assertion.
- `rejects candidate coordinate with longitude above maximum`: same missing-exception assertion.

Preservation check `[preservation] accepts inclusive coordinate boundaries and valid candidates outside crawl area` passed in RED (and the pre-existing fixture checks passed). This confirms those valid candidates remain accepted independently of crawl-area filtering.

## GREEN and final verification

Production change: `parseSyntheticFixture` now rejects blank/whitespace-only `verifiedCanonicalKey` and requires each provided non-null candidate coordinate to have finite numeric latitude/longitude within inclusive latitude [-90, 90] and longitude [-180, 180]. Optional/null coordinates and valid candidates outside the crawl area remain accepted; no place filtering was introduced.

Command: `mise exec -- npm run build && mise exec -- node --test test/operator-fixture.test.mjs`
Result: exit 0; build passed and focused suite passed 18/18. Each of the seven invalid values/classes above now passes its intended rejection assertion. The inclusive-boundary/outside-area preservation test passed.

Commands: `mise install`; `mise exec -- npm ci`
Results: exit 0; pinned Node already installed, dependencies installed, 0 vulnerabilities.

Commands: `mise exec -- npm run build`; `mise exec -- npm run check`; `git diff --check`
Result: all exit 0. Full check passed typecheck, all tests (257/257, 0 failed), and build; diff whitespace check passed.
