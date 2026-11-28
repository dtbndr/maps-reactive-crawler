import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCachedLocationResolver } from '../dist/location-cache.js';

const candidate = { label: 'Synthetic', country: 'FR', latitude: 1, longitude: 2 };
const value = { candidates: [candidate], attribution: 'Synthetic attribution' };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'location-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const resolver = async (_query, country) => { calls++; return { ...value, candidates: [{ ...candidate, country }] }; };
  const make = (endpoint = 'https://one.invalid/search', source = resolver) => createCachedLocationResolver({ directory, endpoint, resolver: source });
  return { directory, make, calls: () => calls };
}

test('cache scope includes endpoint query country and survives restart', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.make()('a', 'FR'), value);
  assert.deepEqual(await f.make()('a', 'FR'), value);
  assert.equal(f.calls(), 1);
  await f.make()('b', 'FR'); await f.make()('a', 'DE'); await f.make('https://two.invalid/search')('a', 'FR');
  assert.equal(f.calls(), 4);
});

test('validated empty results are cached while resolver errors are not', async (t) => {
  const f = await fixture(t); let calls = 0;
  const empty = f.make(undefined, async () => { calls++; return { candidates: [], attribution: 'Synthetic attribution' }; });
  assert.deepEqual((await empty('empty', 'FR')).candidates, []);
  assert.deepEqual((await empty('empty', 'FR')).candidates, []);
  assert.equal(calls, 1);
  const failure = f.make(undefined, async () => { calls++; throw new Error('failure'); });
  await assert.rejects(failure('error', 'FR')); await assert.rejects(failure('error', 'FR'));
  assert.equal(calls, 3);
  const invalid = f.make(undefined, async () => { calls++; return { candidates: [candidate], attribution: '' }; });
  await assert.rejects(invalid('invalid', 'FR')); await assert.rejects(invalid('invalid', 'FR'));
  assert.equal(calls, 5);
});

test('cache persists only validated candidate fields and attribution', async (t) => {
  const f = await fixture(t);
  const resolver = f.make(undefined, async () => ({ ...value, extra: 'not retained', candidates: [{ ...candidate, extra: 'not retained' }] }));
  assert.equal((await resolver('a', 'FR')).attribution, value.attribution);
  assert.deepEqual(await f.make()('a', 'FR'), value);
  const files = await readdir(f.directory); assert.equal(files.length, 1);
  const serialized = await readFile(join(f.directory, files[0]), 'utf8');
  assert.doesNotMatch(serialized, /not retained/); assert.match(serialized, /Synthetic attribution/);
});
