# Slice A1 implementation report

## Implemented

- Added validated operator configuration for one geometry seed, positive spacing, explicit geometry bounds, and independent finite traversal limits. Unknown configuration, geometry, area, seed, or limit fields are rejected.
- Added strict v1 synthetic fixture parsing from bytes, duplicate JSON key detection, shape/result/reference/time validation, and SHA-256 identity over the exact input bytes.
- Exported the operator APIs and added focused fixture/configuration tests. No checkpoint mutation, execution, provider calls, or CLI behavior was added.

## Rulings

- Ruling: `parseSyntheticFixture` accepts a `Uint8Array` rather than a filesystem path — exact-byte identity must not depend on location, and a path-loading interface is not required in this validation-only slice — cost if wrong: a later consumer may need a thin file-reading wrapper.
- Ruling: operator config exposes the existing core geometry and limits as `{ geometry, limits }` — reuses established validated core types and rules — cost if wrong: downstream config construction may need a shape adapter.

## Test Evidence

### RED (recorded before implementation)

Focused command: `mise exec -- node --test test/operator-fixture.test.mjs`

The initial attempt used a named ESM import of a missing API and failed during module loading; this was a load failure and was not counted as RED. Changed the test import to a namespace import and asserted the required API's type so test execution could establish behavioral absence.

Verbatim behavioral failure excerpt:

```text
✖ validates one-seed operator geometry and independent finite limits
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'undefined'
  - 'function'
✖ parses strict v1 synthetic discoveries with exact-byte SHA-256 identity
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'undefined'
  - 'function'
```

This demonstrates the operator validation and fixture parsing APIs required by this slice were absent.

### GREEN

- `mise exec -- npm run build` — passed.
- `mise exec -- node --test test/operator-fixture.test.mjs` — 4 passed, 0 failed.
- `mise exec -- npm run check` — passed: typecheck passed, 226 tests passed, 0 failed, build passed.
- `git diff --check` — passed.

## Files changed

- `src/operator.ts`
- `src/index.ts`
- `test/operator-fixture.test.mjs`
- `.solopowers/wsd/offline-operator-path/report-A1.md`

## Self-review and carry-forward

The parser rejects duplicate keys in nested JSON objects and validates fixture bytes without filesystem coupling. Fixture IDs and observation lookup keys must match exactly and be nonblank. No known issues remain in this slice. No staged files remain after the task-scoped commit.

## Fix round 1 — review findings

### RED (recorded before implementation)

Focused command: `mise exec -- node --test test/operator-fixture.test.mjs` (after `mise exec -- npm run build`, which passed).

Behavioral RED summary: 8 tests, 5 passed, 3 failed. The new prototype-key test and coordinate-field/array-coordinate test failed with `AssertionError [ERR_ASSERTION]: Missing expected exception.` The array-valued failed-scope assertion also failed because array coercion was accepted. These failures establish the requested validation gaps rather than a test load/setup failure. The non-JSON whitespace case passed against current code and did not independently establish a bug in this harness case.

Verbatim excerpt:

```text
✖ rejects prototype-key fixture fields and discovery keys (0.410625ms)
✖ rejects unknown candidate coordinate fields and array coordinates (0.194833ms)
✖ rejects array-valued failure scope (0.132583ms)
ℹ tests 8
ℹ pass 5
ℹ fail 3
  AssertionError [ERR_ASSERTION]: Missing expected exception.
```

The RED command was rerun after correcting the whitespace fixture to contain an actual vertical-tab character. Updated outcome: 8 tests, 4 passed, 4 failed (prototype-field, coordinate object/array, array scope, non-JSON whitespace). Verbatim additional excerpt:

```text
✖ rejects non-JSON whitespace between values (0.093333ms)
ℹ tests 8
ℹ pass 4
ℹ fail 4
  AssertionError [ERR_ASSERTION]: Missing expected exception.
```

### GREEN and review

- `mise exec -- npm run build && mise exec -- node --test test/operator-fixture.test.mjs` — passed; 8 tests, 0 failures.
- `mise exec -- npm run check` — passed; typecheck, all 230 tests (230 passed, 0 failed), and build passed.
- `git diff --check` — passed.
- No staging performed before task commit. No out-of-scope edits were made.

Fixes: duplicate/unknown-key parsing now uses a null-prototype JSON object so `__proto__` remains visible for validation; candidate coordinates must be plain records with exactly latitude/longitude; failed-result scope must be a string enum (not coercible arrays); tokenizer whitespace now follows JSON's four permitted whitespace characters.

Self-review: all four reported defects now have focused negative assertions and pass. No cross-slice conflicts or remaining concerns identified.
