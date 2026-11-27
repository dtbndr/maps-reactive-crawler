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

Full suite not run yet.

## Self-review / carry-forward

The source contract and documentation update remain to be implemented, then the focused and full checks must pass. No live transport route is authorized or supported by the current evidence.
