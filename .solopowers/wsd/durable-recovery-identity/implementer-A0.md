# Slice A0 implementation report

Implemented a version-1 SQLite checkpoint API backed by Node 26 `node:sqlite`, validated persisted state, transactionally committed snapshot transitions, and exclusive PID ownership with stale-owner reacquisition after process death. The API preserves arrays for work, raw observations, and gaps. It is a storage foundation only; it does not make discovery restartable.

## Test evidence
- RED: `node --test test/durable-state.test.mjs` before `src/durable-state.ts` existed failed with `ERR_MODULE_NOT_FOUND: Cannot find module .../dist/durable-state.js`. This confirmed the intentional new API was absent (build-first requirement was honored before running focused tests).
- GREEN: `npm run build && node --test test/durable-state.test.mjs`: build passed; 2 tests passed, 0 failed. Tests cover on-disk reopen/transition and exclusive ownership/reacquisition after close.
- Full check: `npm run check`: typecheck passed, 52 tests passed, 0 failed, build passed.

## Changed files
`src/durable-state.ts`, `test/durable-state.test.mjs`, `package.json`, `package-lock.json`, `tsconfig.json`.

Added `@types/node` as a development dependency for Node types. No runtime SQLite package was added.

## Self-review / carry-forward
Scope is foundational, not a restartable discovery claim. Current focused tests do not yet explicitly exercise unsupported schema, malformed/corrupt payload, or ownership recovery after abrupt process death; those remain acceptance gaps for the slice brief and should be addressed before treating the foundation as complete. The implementation treats state schema version as the checkpoint row's version and validates the JSON shape on open/read.
