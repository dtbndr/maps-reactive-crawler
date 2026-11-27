import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('injectable confirmed orchestration is not shipped as production code', () => {
  assert.equal(existsSync(new URL('../src/synthetic-confirmed-operator.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../dist/synthetic-confirmed-operator.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../dist/synthetic-confirmed-operator.d.ts', import.meta.url)), false);
});
