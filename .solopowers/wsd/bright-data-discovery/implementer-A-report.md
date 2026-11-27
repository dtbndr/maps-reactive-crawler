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
+ actual
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
- `ecd68f8 feat: add fail-closed Bright Data discovery adapter`
- Final report commit records the verified commit list and check results.

## Evidence correction — standard-tier review

**Status: BLOCKED.** Review of the recorded execution/report and available Git history found no genuine pre-implementation behavioral RED evidence. The prior RED descriptions above are not valid behavioral REDs and must not be cited as proof that the intended behaviors failed:

- The initial command recorded was `mise exec -- node --test test/bright-data-discovery.test.mjs`. Its excerpt was `AssertionError [ERR_ASSERTION]: the discovery adapter module must exist` at `requireAdapter` (`test/bright-data-discovery.test.mjs:12:10`), reached from the start/resume test (`:18:18`). This establishes only the absence of the module; it does not establish a behavioral failure of the fail-closed boundary.
- The later command recorded was also `mise exec -- node --test test/bright-data-discovery.test.mjs`. Its excerpt was `Expected values to be strictly equal: + 'undefined' - 'function'` at `test/bright-data-discovery.test.mjs:95:10`. This establishes only the absence of the sanitizer export; the sanitizer behavior assertion did not run.

The report gives relative ordering for these attempts (initial check before implementation; later sanitizer check before restoring its implementation), but no timestamp or elapsed-time record. These excerpts and timings are documented here only to explain why the claimed REDs are insufficient, not as behavioral RED evidence. No other recorded execution/history available for this correction contains an assertion showing an implemented behavior failing for its intended reason. Exact command, assertion excerpt, and timing for a genuine behavioral RED: **none recorded**. No RED has been reconstructed or inferred. Implementation and commits were not changed for this evidence-only correction.

## Reconstructed RED — rung 2 (fresh evidence)

Reviewed tip: `f0cfda6f6eaaa478a8a6891a84488d8e8a798979`; BASE: `8c520228492babce0e32997ec974eccb49da71a1`. A disposable detached worktree was created at `/tmp/maps-reactive-crawler-slice-A-f0cfda6`. The slice implementation `src/bright-data-discovery.ts` did not exist at BASE (the attempted `git checkout 8c52022 -- src/bright-data-discovery.ts` reported `pathspec ... did not match any file(s) known to git`); the slice-added tests were retained. A minimal source stub was added only in the scratch worktree to make the test module build and execute, and deliberately allowed start/resume transport calls rather than enforcing fail-closed behavior.

Scratch setup / build:

- `cd /tmp/maps-reactive-crawler-slice-A-f0cfda6 && mise exec -- npm run build` — initially failed (`Volta error: Could not locate executable tsc`); the detached worktree had no dependencies installed.
- `cd /tmp/maps-reactive-crawler-slice-A-f0cfda6 && mise exec -- npm ci` — passed (4 packages installed; 0 vulnerabilities).
- `cd /tmp/maps-reactive-crawler-slice-A-f0cfda6 && mise exec -- npm run build` — passed.

Behavioral RED command: `cd /tmp/maps-reactive-crawler-slice-A-f0cfda6 && mise exec -- node --test test/bright-data-discovery.test.mjs` — 0 passed, 8 failed. This is an assertion failure against the stub behavior, not an import/build/setup failure:

```text
✖ start and resume do not call transport without production evidence and invocation approval
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual
+ 'submitted'
- 'unsupported'
  at TestContext.<anonymous> (file:///private/tmp/maps-reactive-crawler-slice-A-f0cfda6/test/bright-data-discovery.test.mjs:28:10)
```

GREEN at the exact reviewed tip `f0cfda6f6eaaa478a8a6891a84488d8e8a798979`:

- `mise exec -- npm run build` — passed.
- `mise exec -- node --test test/bright-data-discovery.test.mjs` — 8 passed, 0 failed.

The disposable worktree was removed with `git worktree remove --force /tmp/maps-reactive-crawler-slice-A-f0cfda6`. No actual branch implementation or tests were changed; this append records reconstructed fresh evidence only. No provider calls, .env reads, credentials, or nested agents were used.

## Fix round 1 — independent gate coverage only

Ruling: Add only isolated tests for invocation approval and resume observation evidence; leave adapter implementation unchanged — inspection confirms `unavailable()` already checks invocation approval before allowing either route and checks observation evidence for resume, while the slice finding is a coverage gap — if wrong, a genuinely missing behavior would remain unfixed and require a separate TDD implementation change; changing code here would expand a coverage-only correction and risk contradicting the approved fail-closed contract.

Added two synthetic cases with an API key and all unrelated applicable gates enabled. The invocation-approval case separately supplies submission and observation evidence, denies only invocation approval, calls both `start` and `resume`, and asserts both results are `unsupported` and the shared transport call count remains zero. The resume-observation case supplies invocation/pricing/rights approvals and submission evidence, denies only observation evidence, calls `resume`, and asserts `unsupported` and zero transport calls.

This is coverage-only; no new behavior is intended, so no RED is claimed. Before/after evidence against the unchanged adapter:

- Before test edits: `mise exec -- npm run build` — passed; `mise exec -- node --test test/bright-data-discovery.test.mjs` — 8 passed, 0 failed.
- After test edits: `mise exec -- node --test test/bright-data-discovery.test.mjs` — 10 passed, 0 failed.
- Full required check after edits: `mise exec -- npm run check` — passed; typecheck, all 359 tests passed (0 failed, 0 skipped), build passed.
- `git diff --check` — passed.

Files changed this round: `test/bright-data-discovery.test.mjs`, this report. No source behavior changed; test inputs are synthetic. No credentials or provider calls were used. No staged files existed before committing this round.

## Fix round 2 — gate-specific rejection assertions

Ruling: Keep this correction coverage-only and assert each gate's explicit rejection reason in addition to zero transport calls — the adapter already distinguishes invocation approval, observation evidence, pricing approval, and rights approval, but generic `kind: unsupported` assertions also pass through the final generic disabled-transport fallback if a relevant gate check is removed — if wrong, a reason assertion could couple tests to a diagnostic contract; here those specific reasons are the only reliable way to prove each gate independently blocks an otherwise eligible operation, and cost is limited to updating tests if the wording legitimately changes.

Strengthened the isolated invocation-approval case for both start and resume, the resume observation-evidence case, and independent pricing and rights cases. Each now asserts the exact gate-specific rejection reason and zero transport calls. Start cases use a fully populated bounded request with radius and independent work limits. Pricing and rights cases enable every other applicable gate. Test evidence is synthetic and does not enable transport.

Coverage-only before/after evidence; no behavior change or RED is claimed:

- Before test edit: `mise exec -- npm run build` — passed; `mise exec -- node --test test/bright-data-discovery.test.mjs` — 10 passed, 0 failed.
- After test edit: `mise exec -- npm run build && mise exec -- node --test test/bright-data-discovery.test.mjs` — build passed; focused suite 10 passed, 0 failed. The newly required specific reasons distinguish a gate rejection from the generic unsupported fallback, so deleting an individual applicable guard makes the corresponding assertion fail.
- `mise exec -- npm run check` — passed; project typecheck, complete test suite and build passed.
- `mise exec -- npm test` — 359 passed, 0 failed, 0 skipped.
- `git diff --check` — passed.

Files changed this round: `test/bright-data-discovery.test.mjs`, this report. No source behavior changed; test inputs are synthetic. No credentials or provider calls were used. No staged files existed before committing this round.
