import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapDiscoveryRequest, mapSubmitResponse, mapProgressResponse, mapResultsResponse } from '../dist/bright-data-mapping.js';

const input = { country: 'GB', keyword: 'pizza', lat: 51.5, lon: -0.1, zoom: 14, limit: 2 };
test('maps the documented single input request envelope', () => {
  assert.deepEqual(mapDiscoveryRequest(input), { method: 'POST', path: '/datasets/v3/scrape', query: { dataset_id: 'gd_m8ebnr0q2qlklc02fz', format: 'json', notify: 'false', include_errors: 'true', type: 'discover_new', discover_by: 'location' }, body: { input: [{ country: 'GB', keyword: 'pizza', lat: 51.5, long: -0.1, zoom_level: 14 }], limit_per_input: 2 } });
});
test('maps a 202 snapshot and retry-after', () => {
  assert.deepEqual(mapSubmitResponse(202, { snapshot_id: 's_123' }, '10'), { kind: 'pending', snapshotId: 's_123', retryAfterSeconds: 10 });
});
test('malformed retry-after preserves acknowledged snapshot and marks invalid hint', () => {
  for (const hint of ['', 'invalid', '9007199254740992']) {
    assert.deepEqual(mapSubmitResponse(202, { snapshot_id: 's_123' }, hint), { kind: 'pending', snapshotId: 's_123', retryAfterInvalid: true });
  }
});
test('malformed submit is a gap', () => { assert.equal(mapSubmitResponse(202, {}).kind, 'gap'); });
test('rate limit is classified without exposing body', () => { assert.deepEqual(mapSubmitResponse(429, { error: 'secret' }), { kind: 'gap', reason: 'rate-limited' }); });
test('maps documented progress', () => { assert.deepEqual(mapProgressResponse(200, { status: 'running' }), { kind: 'progress', state: 'running' }); });
test('unknown progress is a gap', () => { assert.equal(mapProgressResponse(200, { status: 'mystery' }).kind, 'gap'); });
test('maps synthetic candidate fields only', () => { assert.deepEqual(mapResultsResponse(200, [{ name: 'A', place_id: 'p', lat: 1, lon: 2, phone_number: 'ignored' }], 2), { kind: 'results', candidates: [{ name: 'A', placeId: 'p', coordinates: { lat: 1, lon: 2 } }], gap: false, expand: true }); });
test('empty results are not expanded', () => { assert.deepEqual(mapResultsResponse(200, [], 2), { kind: 'results', candidates: [], gap: false, expand: false }); });
test('at cap retains candidates but reports gap and disables expansion', () => { assert.deepEqual(mapResultsResponse(200, [{ name: 'A', place_id: 'p' }], 1), { kind: 'results', candidates: [{ name: 'A', placeId: 'p' }], gap: true, expand: false }); });
test('mixed error below cap retains candidate as incomplete without expansion', () => {
  assert.deepEqual(mapResultsResponse(200, [{ name: 'A', place_id: 'p' }, { error: 'secret' }], 3), { kind: 'results', candidates: [{ name: 'A', placeId: 'p' }], gap: true, expand: false });
});
test('mixed malformed row at raw cap retains candidate as incomplete without expansion', () => {
  assert.deepEqual(mapResultsResponse(200, [{ name: 'A', place_id: 'p' }, { name: 'B', place_id: 'q', lat: 91, lon: 1 }], 2), { kind: 'results', candidates: [{ name: 'A', placeId: 'p' }], gap: true, expand: false });
});
test('malformed record produces a gap', () => { assert.equal(mapResultsResponse(200, [{ error: 'secret' }], 2).kind, 'gap'); });
test('invalid coordinates produce a gap', () => { assert.equal(mapResultsResponse(200, [{ name: 'A', place_id: 'p', lat: 91, lon: 1 }], 2).kind, 'gap'); });
test('non-array results produce a gap', () => { assert.equal(mapResultsResponse(200, {}, 2).kind, 'gap'); });

test('inline submit returns records for normalization', () => { assert.deepEqual(mapSubmitResponse(200, []), { kind: 'inline', records: [] }); });
test('failed progress is a gap', () => { assert.equal(mapProgressResponse(200, { status: 'failed', error_message: 'secret' }).kind, 'gap'); });
test('invalid input is a gap', () => { assert.equal(mapDiscoveryRequest({ ...input, country: 'gb' }).kind, 'gap'); });
test('retrieval errors are sanitized gaps', () => { assert.deepEqual(mapResultsResponse(500, { error: 'secret' }, 2), { kind: 'gap', reason: 'unrecognized-response' }); });
