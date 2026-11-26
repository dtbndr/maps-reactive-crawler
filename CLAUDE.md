# Agent guidance

This repository is an early-stage public, MIT-licensed, operator-run Google Maps reactive spatial crawler. The offline bounded traversal core, synthetic SQLite durable recovery/result-identity behavior and fixture-backed operator CLI are implemented and tested; the live-provider end-to-end crawler is not yet implemented. Synthetic identity tests do not establish live-provider identity or behavior.

## Start here

1. Read `README.md`, `docs/happy-path.md`, `docs/roadmap.md`, and `docs/sdlc-priorities.md` before planning or development.
2. If `.memory/MEMORY.md` exists, read it as a supplemental index and open relevant notes; verify memory against current repository evidence. Follow applicable user-level memory conventions and approval requirements before reading or changing memory. If it is absent, continue without creating it.
3. Apply `docs/sdlc-priorities.md` across planning, design, implementation, tests, review and documentation. Focus on evidence-backed P0/P1 items advancing the first-release happy path; surface lower-priority ideas rather than silently expanding scope. At design review, preflight and fix dispatch, assess the supported scenario, evidence of harm and smallest safe solution or workaround, and recheck if cost or scope grows materially. Separate release-impact grades from approved acceptance and required-check gates; never bypass a gate or change an approved contract without operator approval. Include the supported scenario, priority filter and authorization boundaries in delegated planning, implementation and review tasks. Use Phase/Workstream labels, not P grades, for sequencing. When there’s a clear, meaningful next step, briefly recommend it and explain why. A recommendation does not authorize expanding scope or bypassing approval gates.
4. For evidence about reference-repository reactive crawling, geometry, provider flow, persistence, or recovery, consult `docs/research/legacy-reactive-crawl.md` and relevant `docs/research/` handoffs first. Scan reference repositories only when the documented evidence does not answer the specific question, needs verification for the task, or may be stale; record useful verified findings in the appropriate existing handoff or a new research document.

## Boundaries

- Operator provides Bright Data credentials; never put secrets or real customer data into source, fixtures, logs, agent output, checkpoints intended for sharing, or memory.
- A crawl begins at one operator-provided coordinate or resolved location, with explicit radius or bounding box and independent work limits. The connected reactive flow and its coverage limitations must be tested.
- Bright Data MCP is for agentic support; direct API use is permitted with notice. Verify current provider contracts before implementation. Obtain operator approval before paid calls, publishing, or external account changes.
- Use synthetic fixtures for automated tests. Do not treat the legacy unconnected reactive loop as a validated production implementation.
- The standard MIT license covers this project's code; review dependencies and data rights separately.

## Validation and memory

Use `mise install`, then `mise exec -- npm ci` and `mise exec -- npm run check`. Do not add new memory facts without explicit approval. Never put secrets, email addresses, or absolute home paths in memory. Preserve applicable user-level memory conventions.
