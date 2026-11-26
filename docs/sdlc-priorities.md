# AI SDLC priority grading

Apply this filter to planning, design, implementation, tests, review and documentation. Grade by demonstrated impact on the [first-release happy path](happy-path.md), not by technical category or personal preference. State the evidence and affected outcome.

- **P0 — critical:** blocks safe use of the release or creates immediate severe harm, such as credential exposure, destructive data loss or an unusable core flow.
- **P1 — high:** directly prevents a correct, safe or useful first-release outcome, or materially threatens its acceptance without a reasonable workaround.
- **P2 — moderate:** a real limitation with a reasonable workaround or limited impact; not required for the agreed first-release path.
- **P3 — low:** cosmetic, speculative or future-facing improvement with little current impact.

Focus effort on evidence-backed P0/P1 concerns that advance the agreed path. Record P2/P3 briefly without expanding them into implementation unless the owner approves or evidence changes their priority. Escalate borderline grades or scope changes to the owner. Correctness alone does not make a change release-critical. Reserve P0–P3 for impact grading; use Phase and Workstream for sequencing.

Before adding a material requirement, safeguard, dependency, test matrix or documentation obligation, identify the supported operator scenario, evidence of harm, and smallest safe solution or reasonable workaround. Recheck when cost or scope grows materially. Apply this at existing design review, preflight and fix-dispatch decisions; test supported failure modes without expanding into speculative platforms or concurrency. Document supported usage and limitations rather than promising unsupported scenarios. If a simpler solution changes an approved contract, stop and ask the owner.

Release-impact grading and acceptance are separate: use project P0–P3 for first-release impact, and record separately whether an approved acceptance criterion or required check is unmet. Do not pass an unmet gate, inflate its release grade, or dispatch a broader fix without adjudicating the finding. Preserve required test and review gates even when release impact is lower.

A priority grade is not authorization for paid provider calls, publication, account changes or other external side effects. Include the supported scenario, happy path, applicable priority filter and authorization boundaries in delegated planning, implementation and review tasks.
