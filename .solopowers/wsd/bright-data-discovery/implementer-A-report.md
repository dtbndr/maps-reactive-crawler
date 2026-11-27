# Implementer A — Slice A report

## Test Evidence — RED (recorded before implementation edits)

Build prerequisite: `mise exec -- npm run build` — passed (`tsc`).

RED command: `mise exec -- node --test test/bright-data-discovery.test.mjs`

Verbatim failure excerpt:

```text
✖ start and resume do not call transport without production evidence and invocation approval
AssertionError [ERR_ASSERTION]: the discovery adapter module must exist
  at requireAdapter (test/bright-data-discovery.test.mjs:12:10)
  at TestContext.<anonymous> (test/bright-data-discovery.test.mjs:18:18)
```

The focused test runner executed all five tests and reported 0 passed, 5 failed; this was an assertion failure after a caught missing-module import, not a module-load/test-runner error. It demonstrates the missing adapter API needed to provide the specified fail-closed start/resume behavior. The test captures the behavioral boundary by expecting an adapter module and then checks zero transport calls. No implementation file has been edited yet.

## Initial scope decisions

Ruling: Keep all transport routes unsupported until the production terminal approval gate is complete — the reviewed operation matrix documents discovery inputs but leaves asynchronous lifecycle/result retrieval and method-specific behavior unresolved, so no real branch is sufficiently evidenced — if wrong, operator-approved runtime integration work will need a subsequent slice after authoritative evidence and approval.

## Work attempted

Added focused synthetic tests for disabled start/resume, submission evidence without observation evidence, known-ID-only mode, independent pricing/rights gates, and credential-free diagnostics. No live provider calls, credentials, or external side effects were used.

## Files changed

- `test/bright-data-discovery.test.mjs` (test-first)
- This report (RED evidence saved before implementation edits)

## Validation

- `mise exec -- npm run build` — passed before RED.
- `mise exec -- node --test test/bright-data-discovery.test.mjs` — expected RED above.

Additional TDD round — diagnostic red, recorded before restoring the sanitizer implementation:

- Build prerequisite: `mise exec -- npm run build` — passed.
- RED command: `mise exec -- node --test test/bright-data-discovery.test.mjs` — 7 passed, 1 failed.
- Verbatim behavioral assertion excerpt:

```text
✖ provider diagnostic sanitizer preserves useful text and removes credentials
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'undefined'
- 'function'
  at TestContext.<anonymous> (test/bright-data-discovery.test.mjs:95:10)
```

This failure is an assertion that the sanitizer API required by the credential-redaction check is absent; compilation and test execution succeeded. It is not a load error. The focused test expects useful diagnostic text to remain while the synthetic credential is removed.

## Implementation and verification

Implemented a typed async submit/observe transport seam and fail-closed adapter. Start and resume never invoke injected transport, even with a key, approval flags, and submission/observation evidence; missing gates return useful static reasons. Known-ID-only mode never submits. Request types omit credentials. Added a diagnostic sanitizer that preserves useful text while removing configured credentials and common bearer/API-key forms. Updated the research handoff with dated/source-specific direct HTTP versus MCP/SDK comparison; no SDK-specific contract or runtime parity is claimed.

Commands and results:

- `mise exec -- npm run build` — passed before focused tests.
- `mise exec -- node --test test/bright-data-discovery.test.mjs` — 8 tests passed, 0 failed.
- `mise exec -- npm run check` — passed (typecheck, full tests and build).
- `mise exec -- npm test` — 357 tests passed, 0 failed, 0 skipped.
- `git diff --check` — passed.

No baseline failures were observed. No paid/provider calls or real credentials were used.

## Files changed

- `src/bright-data-discovery.ts`
- `test/bright-data-discovery.test.mjs`
- `docs/research/bright-data-mcp.md`
- `.solopowers/wsd/bright-data-discovery/implementer-A-report.md`

## Self-review / carry-forward

All routes remain deliberately disabled until method-specific submit/observe contract evidence and the production terminal approval gate exist. The typed transport seam is ready for a later approved implementation, but does not imply provider compatibility, billing or rights. Input validation/provider payload handling is not enabled because no request is transmitted in this slice. No blockers or additional rulings.

Commits created:
- `91f13f1 test: specify fail-closed Bright Data discovery boundary`
- Implementation commit: record after committing the verified slice changes.
