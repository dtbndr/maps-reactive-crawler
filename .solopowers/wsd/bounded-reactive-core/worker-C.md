# Slice C fix round 4 — admitted unreserved cap reporting

- Fixed the remaining P1 in `reportTraversal`: an admitted running cell with no reserved attempt now counts as remaining work blocked by active-time equality or submission-cap equality. Reserved attempts remain separately evaluated, preserving dispatchable last-slot and observation behavior.
- Added exact outcome/reason assertions for an admitted cell blocked before its first reservation by submissions or active time. Strengthened the fresh crawl assertion to exact `in_progress/in_progress`.
- Behavioral RED: temporarily restored the prior reporting conditions and ran the focused suite; it exited 1 on the added expected cap-report behavior. Restored implementation; focused suite passed after rebuild.
- `npm run check` was attempted but failed: existing/related report assertion expected `in_progress` but got `submissions`. No commit made yet pending diagnosis.
- No provider calls.

# Slice C fix round 3 — truthful cap reporting

Read round-2 review verbatim from findings-C.md and covered each requested case.

- Added assertions for both `outcome` and `stopReason`: reserved last slot remains `in_progress/in_progress`; known-ID observation at time equality remains `in_progress/in_progress`; fresh below-cap crawl is `in_progress/in_progress`; reserved attempt blocked at active-time cap is `partial_limit/active_time`; reserved attempt blocked after cap lowered below charged submissions is `partial_limit/submissions`.
- Before fix, these cases failed meaningfully: existing behavior reported `partial_limit/submissions` for a dispatchable last-slot reservation and `partial_limit` for fresh crawl; reporting only keyed cap stop to queued cells, so reserved work blocked by active-time/lowered submission cap was hidden as in-progress. RED assertions were added before implementation.
- Reporting now separates in-progress from partial-limit outcome. A reserved attempt is a basis for active-time stop only when dispatch is prohibited by time equality; submission stop for a reserved attempt requires charged total strictly above the lowered current cap. Equality remains dispatchable. Known-ID observed attempt is not treated as blocked because observation/result processing remains legal.
- During validation, an existing known-ID test still expected `partial_limit`; systematic diagnosis showed expectation contradicted the truthful in-progress contract. Updated only that report expectation. No fixture setup error was counted as RED.
- `npm run build >/dev/null && npm run check` passed (typecheck, 41 tests, build); final captured exit code 0. No provider calls; uncommitted changes preserved.

## Round 4 evidence correction (fcac12b)

- Focused GREEN verified against commit `fcac12be2521a9a068a0eb3fddf76a4ce70fe702`: `npm run build >/dev/null && node --test test/bounded-traversal.test.mjs` exited 0 (27 passed, 0 failed).
- Exact pre-fix RED evidence recovered from `/tmp/slice-c-red.log` does **not** establish both requested first-cell-cap cases. It shows a failure at `test/bounded-traversal.test.mjs:308`: actual `submissions`, expected `in_progress` in the reserved-last-slot trace. This is not either new first-cell case.
- No separate exact pre-fix assertion output for the admitted/unreserved submission-cap and active-time-cap traces is available in retained logs/session artifacts. Do not claim RED evidence for either case. Both exact assertions are present in the committed focused test; controller reports full check passing at fcac12b.

## Round 4 independent evidence reconstruction (02e5d1e vs fcac12b)

Scratch worktree `/tmp/bounded-reactive-evidence` checked out pre-fix `02e5d1e`; no historical RED or test-first ordering is claimed.

- On pre-fix source, built output with `npm run build >/dev/null` (exit 0; scratch linked existing dependency directory), then ran `node --test test/bounded-traversal.test.mjs` (exit 0): 27 passed, 0 failed. The round-four source test has two distinct newly added first-cell cap cases: (1) admitted running cell, `submissions: 0`, asserted report `stopReason === 'submissions'` and `outcome === 'partial_limit'`; (2) admitted running cell, debit to active-time equality, asserted `active_time` and `partial_limit`.
- Isolated assertion replay against that built pre-fix source, using the same geometry construction as the test: submissions case failed first assertion (`actual 'in_progress'`, expected `'submissions'`), process exit 1. This isolates only submissions behavior; the assertion sequence stops before active-time assertion.
- Separate assertion replay is still required for active-time behavior: **not executed**. Do not infer its failure or pass from the combined replay.
- GREEN at `fcac12b`: `npm run build >/dev/null && node --test test/bounded-traversal.test.mjs` was confirmed in prior retained evidence: exit 0, 27 passed, 0 failed. The assertions above are present in that commit's test source.
- No provider calls. Scratch worktree cleanup performed after evidence collection.

## Round 4 independent evidence reconstruction (02e5d1e vs fcac12b)

Scratch worktree checked out pre-fix `02e5d1e`; no historical RED or test-first ordering is claimed.

- Pre-fix build: `npm run build >/dev/null` (exit 0; scratch linked the existing dependency directory). Running the round-four test file on pre-fix produced 27/27 green (exit 0), which establishes no RED for the tests as a suite.
- Isolated submission-cap replay used the exact round-four setup and assertion pair from test `reserved last slot and known-ID observation are not reported as prevented limits`: admitted running first cell with submissions limit 0; asserted `stopReason === 'submissions'`, `outcome === 'partial_limit'`. Exit 1 on first assertion: actual `in_progress`, expected `submissions`.
- Isolated active-time replay: admitted running first cell with activeTime limit 1, debited 1, asserted `stopReason === 'active_time'`, `outcome === 'partial_limit'`. Exit 1 on first assertion: actual `in_progress`, expected `active_time`.
- GREEN at `fcac12b`: `npm run build >/dev/null && node --test test/bounded-traversal.test.mjs`: exit 0, 27 passed, 0 failed (retained verification). Both exact assertion pairs are in the committed test file.
- No provider calls.

# Slice C fix round 5 — per-running-cell stop attribution

- Reproduced reviewer trace with narrow bbox seed, east candidate, queue and blocked lists empty, completed seed attempt retained, and east cell running.
- Added separate submission-cap and active-time-cap behavioral tests. Pre-fix exact RED: both report assertions failed; submission actual `in_progress`, expected `submissions` (test line 348); active-time actual `in_progress`, expected `active_time` (test line 362). Tests also assert no queued/blocked work and running east cell.
- `reportTraversal` now considers an attempt outstanding for cap attribution only when it belongs to a currently running cell; historical completed-cell attempts no longer mask blocked first reservations.
- Focused GREEN passed for both tests. `npm run check` passed (typecheck, complete test suite, build).
- No provider calls.
