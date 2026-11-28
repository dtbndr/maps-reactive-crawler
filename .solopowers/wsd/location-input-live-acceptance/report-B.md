# Slice B implementation report

## Documentary recheck (2026-11-28 UTC)

Documentation only; no Nominatim Search, geocoding, paid or credentialed calls. Primary sources accessed with `curl -L -sS --max-time 15` on 2026-11-28:

- [Nominatim Search 5.3.3](https://nominatim.org/release-docs/latest/api/Search/): `q` is free-form search, `countrycodes` filters by ISO 3166-1 alpha-2, `addressdetails=1` returns address breakdown and `format=jsonv2` chooses the format. Country is taken from structured `address.country_code`, not parsed from a label; missing or mismatched country is rejected.
- [OSMF Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/): max one request/second, identifying Referer or User-Agent, attribution and ODbL; applications must be switchable without an update; caching is encouraged; autocomplete is forbidden. These policy obligations remain B1's gate, not a claim this adapter alone complies. Independent operators cannot guarantee aggregate compliance.
- [OpenStreetMap copyright and licence](https://www.openstreetmap.org/copyright): attribution and ODbL are required; retention or reuse can carry database rights/share-alike obligations. No blanket retention permission is inferred. No raw response is stored by this slice. B1 must assess its scoped cache and the selected service's terms; the policy is not an SLA.

No documented incompatibility discovered for the approved synthetic-only slice; the public endpoint is not the default and the CLI is not exposed.

## Rulings

- Endpoint and transport are explicit, with no network implementation: this permits switching and guarantees this slice cannot itself initiate a provider call. Cost if wrong: B1 integration must adapt its transport interface.
- Use fixed OSM attribution for the supported Nominatim/OSM data scenario; selectable third-party services may impose additional attribution or retention terms, to be resolved before their use. Cost if wrong: insufficient third-party attribution; no provider use is authorized here.
- Candidate country is normalized to uppercase only after validating structured two-letter evidence and matching explicit requested uppercase country. Missing or mismatched evidence fails closed; cost if wrong is rejecting usable responses.

## Tests and commands

Initial module-absent run failed at import and is not behavioral evidence. Created a compiling inert adapter and ran:

`mise exec -- npm run build && mise exec -- node --test test/nominatim-search.test.mjs`

RED exit 1: `configured endpoint, country filter, identification and explicit invocation` failed `0 !== 1`; `validated handoff` failed on invalid resolver result. Added targeted country, errors and identification cases, re-ran the same command with the inert adapter: exit 1, `pass 0`, `fail 5`; all five named behavioral tests failed. The inert adapter was then replaced with the implementation. This RED demonstrates representative behavioral failures but does not independently demonstrate a RED for every assertion in each grouped test; that is a test-evidence limitation, not an assertion that each requirement had a separate RED.

GREEN: `mise exec -- npm run build && mise exec -- node --test test/nominatim-search.test.mjs` exit 0; five tests pass, zero fail. Positive controls include successful candidate resolution, nonempty identification, successful empty response, valid structured country and explicit invocation. `mise exec -- npm run check` exit 0: 509 tests pass, zero fail, typecheck and build pass.

## Remaining gates

No provider-backed CLI exposure; B1 cache, serialized 1.1-second spacing including retries, cross-process coordination, operator policy and selected-service rights remain unverified. No live-provider behavior is established. RED evidence is grouped rather than isolated for every requirement.

## Controller RED gap record

Slice B: RED gap: endpoint switching, request fields, attribution, structured country and error variants — rung 2 tried: detached 4ac62ca, restored implementation to compiling stub, mise exec -- node --test test/nominatim-search.test.mjs → grouped assertions masked later cases and country test TypeError — why it fails: cannot isolate entangled test assertions — worker-attested: grouped pre-edit RED, no individual failures — GREEN at 4ac62ca

Reconstruction details: `evidence-B-reconstruction.md` in local workspace; reconstructed explicit invocation, malformed response and blank identification failures are fresh evidence, not historical RED. Coverage remains subject to review.

## Fix round 1 — assigned ISO country validation

P1 fixed at `ce8e93d`: both the location handoff and Search adapter now reject countries outside a shared set of the 249 assigned ISO 3166-1 alpha-2 codes before invoking their resolver or transport. Existing uppercase input and lower-to-upper candidate normalization remain unchanged. The input check also prevents an endpoint's `zz` country evidence from being accepted for requested `ZZ`. P2 non-decimal coordinate parsing is intentionally untouched.

Ruling: a local, explicit assigned-code set avoids network access and runtime locale-specific treatment of reserved codes. Cost if wrong: outdated ISO assignments can cause false acceptance/rejection, so future ISO assignment changes require updating the set.

Behavioral RED, before implementation edits, after adding both tests:

```sh
mise exec -- npm run build >/tmp/slice-b-fix-red-build.log 2>&1 && mise exec -- node --test test/location-input.test.mjs test/nominatim-search.test.mjs >/tmp/slice-b-fix-red.log 2>&1
```

Exit 1. Raw excerpts (both tests ran independently):

```text
✖ rejects unassigned country before invoking resolver
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  1 !== 0

✖ unassigned country never reaches Search transport
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

The first negative test's resolver happened to reject downstream on candidate mismatch after being invoked; its separate count assertion caught the dispatch. Each test also includes an assigned `FR` positive control exercising the same resolver or transport. The RED failure stops before those positive controls, which execute in GREEN.

GREEN:

```sh
mise exec -- npm run build >/tmp/slice-b-fix-green-build.log 2>&1 && mise exec -- node --test test/location-input.test.mjs test/nominatim-search.test.mjs >/tmp/slice-b-fix-green.log 2>&1
mise exec -- npm run check >/tmp/slice-b-fix-check.log 2>&1
```

Both exit 0: focused 19 passed, 0 failed; full check 511 passed, 0 failed, plus typecheck and build. A local enumeration of the set returned 249 entries. No network or provider access was made in this fix round.
