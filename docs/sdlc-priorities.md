# AI SDLC priority grading

Apply this filter to planning, design, implementation, tests, review and documentation. Grade by demonstrated impact on the [first-release happy path](happy-path.md), not by technical category or personal preference. State the evidence and affected outcome.

- **P0 — critical:** blocks safe use of the release or creates immediate severe harm, such as credential exposure, destructive data loss or an unusable core flow.
- **P1 — high:** directly prevents a correct, safe or useful first-release outcome, or materially threatens its acceptance without a reasonable workaround.
- **P2 — moderate:** a real limitation with a reasonable workaround or limited impact; not required for the agreed first-release path.
- **P3 — low:** cosmetic, speculative or future-facing improvement with little current impact.

Focus effort on evidence-backed P0/P1 concerns that advance the agreed path. Record P2/P3 briefly without expanding them into implementation unless the owner approves or evidence changes their priority. Escalate borderline grades or scope changes to the owner. Correctness alone does not make a change release-critical. Reserve P0–P3 for impact grading; use Phase and Workstream for sequencing.

A priority grade is not authorization for paid provider calls, publication, account changes or other external side effects. Include the happy path, applicable priority filter and authorization boundaries in delegated SDLC tasks.
