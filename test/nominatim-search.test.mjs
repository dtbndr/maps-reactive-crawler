import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNominatimResolver } from '../dist/nominatim-search.js';
import { resolveLocation } from '../dist/location-input.js';

const attribution = '© OpenStreetMap contributors';
const row = { display_name: 'Paris, France', lat: '48.85', lon: '2.35', address: { country_code: 'fr' } };
function harness(payload = [row], status = 200) {
  const calls = [];
  return { calls, transport: async (url, options) => { calls.push({ url: new URL(url), options }); return { ok: status === 200, status, json: async () => payload }; } };
}
const config = (endpoint, transport) => ({ endpoint, identification: 'crawler-test/1.0 (operator@example.invalid)', transport });
test('configured endpoint, country filter, identification and explicit invocation', async () => {
  const h = harness(); const resolver = createNominatimResolver(config('https://example.invalid/search', h.transport));
  assert.equal(h.calls.length, 0); // No request while text is being entered.
  const result = await resolver('Paris', 'FR');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url.origin, 'https://example.invalid');
  assert.equal(h.calls[0].url.searchParams.get('q'), 'Paris');
  assert.equal(h.calls[0].url.searchParams.get('countrycodes'), 'fr');
  assert.equal(h.calls[0].url.searchParams.get('addressdetails'), '1');
  assert.equal(h.calls[0].url.searchParams.get('format'), 'jsonv2');
  assert.match(h.calls[0].options.headers['User-Agent'], /crawler-test/);
  assert.equal(result.attribution, attribution); assert.deepEqual(result.candidates, [{label: row.display_name, country: 'FR', latitude: 48.85, longitude: 2.35}]);
  const publicResolver = createNominatimResolver(config('https://nominatim.openstreetmap.org/search', h.transport));
  await publicResolver('Paris', 'FR'); assert.equal(h.calls[1].url.hostname, 'nominatim.openstreetmap.org');
  assert.throws(() => createNominatimResolver(config('', h.transport)));
});
test('validated handoff, country normalization and empty versus failure', async () => {
  const h = harness(); const resolver = createNominatimResolver(config('https://example.invalid/search', h.transport));
  const selected = await resolveLocation('Paris', 'FR', resolver, async (display) => { assert.match(display, /OpenStreetMap contributors/); return 0; });
  assert.deepEqual(selected, { country: 'FR', latitude: 48.85, longitude: 2.35 });
  assert.deepEqual((await createNominatimResolver(config('https://example.invalid/search', harness([]).transport))('x', 'FR')).candidates, []);
  await assert.rejects(createNominatimResolver(config('https://example.invalid/search', harness([], 429).transport))('x', 'FR'));
  await assert.rejects(createNominatimResolver(config('https://example.invalid/search', async () => { throw Error('network'); }))('x', 'FR'));
  for (const bad of [{...row, address: {}}, {...row, address: {country_code: 'de'}}, {...row, lat: 'NaN'}, {...row, lon: '181'}]) {
    await assert.rejects(createNominatimResolver(config('https://example.invalid/search', harness([bad]).transport))('x', 'FR'));
  }
  assert.equal((await resolver('Paris', 'FR')).candidates.length, 1);
});
test('structured country code accepts documented lowercase and uppercase but rejects absent or wrong country', async () => {
  const resolve = (value) => createNominatimResolver(config('https://example.invalid/search', harness([value]).transport))('Paris', 'FR');
  assert.equal((await resolve({...row, address: {country_code: 'FR'}})).candidates[0].country, 'FR');
  await assert.rejects(resolve({...row, address: {}}));
  await assert.rejects(resolve({...row, address: {country_code: 'de'}}));
});
test('invalid response and HTTP failure do not become empty results', async () => {
  const resolve = (h) => createNominatimResolver(config('https://example.invalid/search', h.transport))('Paris', 'FR');
  assert.equal((await resolve(harness([]))).candidates.length, 0);
  await assert.rejects(resolve(harness({})));
  await assert.rejects(resolve(harness([], 429)));
});
test('identification is required', () => {
  assert.throws(() => createNominatimResolver({...config('https://example.invalid/search', harness().transport), identification: '  '}));
  assert.doesNotThrow(() => createNominatimResolver(config('https://example.invalid/search', harness().transport)));
});
