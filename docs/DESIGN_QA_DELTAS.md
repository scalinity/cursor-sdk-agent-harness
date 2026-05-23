# Design QA Deltas — v1.1

Items found during the Phase 14 design QA pass (see `DESIGN_QA_PASS.md`).
Severity legend:
- **P0** — ship-blocker. Must be fixed before v1.1.
- **P1** — important polish; should land soon.
- **P2** — nice-to-have; defer to v1.2.

| # | Severity | Surface | Description | Notes / Rationale |
|---:|---|---|---|---|
| 1 | P2 | Composer | The Composer's model picker uses native `<select>` styling on non-macOS browsers; the mockup shows a custom dropdown affordance. | Defer to v1.2 — native select is accessible and works everywhere; the custom dropdown is a v1.2 polish. |
| 2 | P2 | EventTimeline | The timeline is not yet wrapped in `@tanstack/react-virtual`. Spec §13 says virtualization threshold is >200 events; today the React tree handles 10k events in ~15ms under jsdom (see `tests/perf/timeline-render.bench.ts`). | Tighten the perf budget when virtualization lands. |

## Zero P0 / P1 deltas

The design QA pass found no P0 or P1 deltas. The mockup is closely
followed; the two P2 items above are nice-to-have polish, not
correctness or visual gaps.
