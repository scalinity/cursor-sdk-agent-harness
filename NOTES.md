# NOTES — out-of-scope follow-ups

Running list of issues spotted during the Tier 1 CLI render refactor that are
deliberately **not** fixed in this tier. Tier numbers refer to the 3-tier plan
(1 = Rendering, 2 = Information Architecture, 3 = Visual Identity).

## From the scroll-back feature review (2026-05-27)

- **Scroll indicator: first Shift+↑ press doesn't advance the top line.**
  `bodyHeight` shrinks by one exactly as `scrollOffset` goes 0→1 (to make room
  for the indicator row), so `start = N − bodyHeight − offset` is identical at
  offsets 0 and 1 — the newest line hides behind the indicator instead of an
  older line appearing at the top. Offsets ≥ 2 scroll correctly. The current
  "indicator covers the newest line" model is defensible; changing it is a
  non-local scroll-semantics decision. **Deferred pending a product call**
  (`apps/cli/src/repl/StreamView.tsx` `clampStreamScrollOffset` / `StreamView`).

- **`clampStreamScrollOffset` vs `renderViewportLines` min-width drift.**
  Clamp wraps at `Math.max(12, width)`, the renderer at `Math.max(10, width)`
  (`StreamView.tsx:117` vs `:130`). They only diverge below width 12, and `App`
  always passes `width ≥ 12`, so it's latent. Pre-existing — not introduced by
  the scroll feature. Unify the floor when this area is next touched.

## From the rendering audit (Phase 0) — Tier 2 / Tier 3 scope

- **Header/Status field duplication** (cwd, model, mode, connection, run state
  appear in both `HeaderBar` and `StatusBar`). → Tier 2.
- **`StatusBar.formatStatusBar` vs live render drift** — the exported
  `formatStatusBar` uses a `│`-joined format only consumed by tests; the live
  `StatusBar` render uses a different `·`-joined format. → Tier 2.
- **Dead code**: `ToolCallLine` React component (`ToolCallLine.tsx:22`),
  `ThinkingBlock`/`formatThinking` (`ThinkingBlock.tsx`), unused `theme.cyan`
  token, unused `ink-text-input` dependency. Remove during the relevant tier.
- **ANSI-loss-on-wrap in `hardWrapText`** (`theme.ts:88`) — over-width lines are
  `stripAnsi`'d before wrapping, so colored content wider than the viewport
  renders uncolored. Cross-cutting; may force a decision during 1.5 (diffs) and
  1.3 (token migration).
- **Palette is hex in the CLI** vs the OKLCH convention used elsewhere. → Tier 3
  color decision.
- **Conditional hook ordering in `StreamView`** — the second `useMemo` sits
  after the `height === undefined` early return. Pre-existing; works because
  `height` is consistently defined/undefined per call site, but it violates the
  rules-of-hooks letter. Address if `StreamView` is restructured.
