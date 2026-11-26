# Maps Reactive Crawler

An early-stage operator-run, open-source Google Maps spatial crawler. The bounded offline traversal and synthetic SQLite recovery path have an operator CLI; **live-provider crawling and location resolution are not implemented.** Synthetic fixture identity tests do not establish live-provider identity or behavior. The intended first release starts from one location and expands to neighboring cells based on results, within explicit geographic and work limits.

## First-release direction

- A TypeScript library and CLI with local SQLite checkpoints.
- Operator supplies a coordinate or human-readable location, a keyword, and an explicit radius or bounding box.
- Bright Data infrastructure, with each operator supplying their own API key. Bright Data MCP supports agentic workflows; direct API use is permitted with notice.
- A bounded, resumable crawl with deduplicated results and clear status, errors and coverage limitations.

See the [happy path](docs/happy-path.md), [roadmap](docs/roadmap.md), and [SDLC priorities](docs/sdlc-priorities.md). Coverage is heuristic, not exhaustive; provider behavior and terms still need verification.

## Development setup

Install [mise](https://mise.jdx.dev/), then:

```sh
mise trust
mise install
mise exec -- npm ci
mise exec -- npm run check
```

`mise.toml` pins Node 26.13.1, the latest LTS release verified at setup. Run commands under `mise exec --` or enable the mise shell integration. Tests are offline and require no Bright Data credentials. They cover geometry, traversal, work limits, and synthetic SQLite durable recovery and result identity across fresh-process restarts. They do not validate a live provider or its identity, retry, billing, lookup, or cancellation contracts.

## Offline operator CLI

Build the CLI and run it with a local versioned synthetic fixture and checkpoint:

```sh
mise exec -- npm run build
mise exec -- node dist/cli.js start --checkpoint ./crawl.db --fixture ./fixture.json --lat 37.77 --lon -122.42 --spacing-m 500 --radius-m 1000 --cells 20 --submissions 20 --active-ms 60000
mise exec -- node dist/cli.js status --checkpoint ./crawl.db
mise exec -- node dist/cli.js resume --checkpoint ./crawl.db --fixture ./fixture.json --submissions 40
mise exec -- node dist/cli.js export --checkpoint ./crawl.db
```

`start` requires one coordinate, spacing, exactly one radius or bounding box, and independent cell, submission and active-time limits. `resume` requires the same fixture and only accepts explicitly increased limits; it does not change geometry. `status` and `export` inspect an existing checkpoint. The CLI is offline and fixture-backed: no provider or geocoder is called. Keep fixture and checkpoint files local and synthetic.

Coverage is heuristic, not exhaustive. In status, `cells` means neighbors were blocked when results were expanded; it does not necessarily mean the cell limit was reached. Raising a limit does not promote neighbors blocked at expansion. Pending detail work is recorded but is not executed by this path. Export preserves source provenance and separates unverified observations from fixture-verified identity groups; this is not a claim about real-provider identity. See [the happy path](docs/happy-path.md) for further boundaries.

The example environment file contains a placeholder, not a working integration. Never commit credentials, provider data or checkpoint files. Live provider calls may incur charges and require explicit operator approval.

## Contributing and license

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE). The license does not itself grant rights to redistribute collected data.
