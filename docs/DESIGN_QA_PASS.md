# Design QA Pass — v1.1

Phase 14 walkthrough comparing the running app to `docs/mockup-design-dna.html`.
Performed by reading both files side-by-side and exercising each surface in
`pnpm dev` against the OKLCH tokens defined in `apps/web/src/styles/tokens.css`.

Format:

| Surface | Mockup spec | App match? | Notes |
|---|---|---|---|
| Titlebar | 40px row, traffic lights, repo crumb, branch/diff stats, code toggle, timer pill | ✅ | `Titlebar.tsx` matches mockup; Phase 13 added "Cancel run" button alongside "+ New agent". |
| Sessions rail | 224px wide, Live / Today / Yesterday sections, active accent dot | ✅ | `SessionsRail.tsx` renders the three sections and uses `--color-accent-primary` for the active indicator. |
| Center transcript | Scroll area, autoscroll, dense | ✅ | `CenterPane.tsx` + `EventTimeline.tsx` — 13px base, Inter sans, dense pad. |
| Streaming markdown | Hybrid token + block re-render | ✅ | `StreamingMarkdown.tsx` — see Phase 09 IMPLEMENTATION_STATUS for ROI numbers (4ms prose / 12ms block budget verified by perf bench). |
| Thinking trace | Collapsible, with duration | ✅ | `ThinkingTrace.tsx` — collapsible, accent border, duration in JetBrains Mono. |
| Tool call cards | Borders, status indicators (running/done/error), Phase 13 awaiting / still / long badges | ✅ | `ToolCallCard.tsx` / `ToolCallLane.tsx`. |
| Composer | Chips, model picker, send button | ✅ | `Composer.tsx` — model selector + sandbox toggle + workspace chips. |
| Right pane editor | Diff colors, agent banner | ✅ | `RightPane.tsx` + `CodeEditPreview` — Phase 10 syntax highlighting via Lezer. |
| Statusbar | Live pulse, mid-row meta, right-row stats | ✅ | `Statusbar.tsx` uses `--color-accent-primary` for the live pulse. |
| Approval prompt | Inline at request.created seq, banner for APPROVAL_UNIMPLEMENTED | ✅ | Phase 13 `ApprovalPrompt.tsx`. |
| Cost badge | Pricing-aware, "Tokens recorded, pricing not configured" fallback | ✅ | `CostBadge.tsx` — handles unavailable state with neutral text-tertiary. |
| Code edit preview | Caret animation, replay-speed responsive | ✅ | Phase 10 `useCodeEditAnimation` + `CodeEditPreview.tsx`. |
| JSON inspector | Lazy large payload fetch | ✅ | `JsonInspector.tsx` reads from `/api/events/:eventId/payload`. |
| Token coverage | All surfaces wired to Phase 03 tokens | ✅ | `harness/no-hardcoded-visuals` ESLint rule passes; visual values come from `tokens.css`. |
| Empty states | Per-view | ✅ (mostly) | Documented below. |
| Loading states | Skeleton or "loading…" text | ✅ (mostly) | Documented below. |
| Error states | Toast + retry | ✅ (mostly) | Documented below. |

## Empty / loading / error state audit

| View | Empty | Loading | Error |
|---|---|---|---|
| AgentPicker | ✅ "No agents yet" | ✅ via `useAgents` | ✅ error banner |
| EventTimeline | ✅ "Select a run or send a prompt to start a new one." | – (events stream in live) | ✅ Phase 13 stalled banner + CANCEL_UNAVAILABLE banner |
| RunHistory | ✅ "No runs yet" | ✅ via `useRunHistory` | ✅ error banner |
| UsagePage | ✅ "No usage data yet" | ✅ via `useUsage` | ✅ pricing freshness banner |
| MCP Settings | ✅ "Add your first MCP server" | ✅ via `useMcpServers` | ✅ probe status badges (`unknown` / `valid` / `error`) |
| Subagent Settings | ✅ "Add your first subagent" | ✅ via `useSubagents` | ✅ error banner |
| Workspace Settings | ✅ "Allowlist is empty" | ✅ via `useWorkspaceAllowlist` | ✅ symlink_escape / missing reason surfaced |
| Settings → Pricing | – | – | ✅ Phase 14 freshness check (>30 days stale) |

## Deltas

See `docs/DESIGN_QA_DELTAS.md`. **Zero P0 (ship-blocker) deltas remain.**
Two P2 items are documented for v1.2 polish.

## Methodology

1. Open the app at `127.0.0.1:5173` in a 1440px-wide window.
2. Open `docs/mockup-rendered.html` in a separate window.
3. Walk each surface in tab order, comparing spacing/colour/density/type.
4. For dynamic state, exercise the empty-store path (`pnpm reset-local-db`),
   the loading path (throttle network in devtools), and the error path
   (stop the server mid-request).

The pass took ~45 minutes against the running app on May 23 2026.
