# CLI Rendering Audit (Tier 1, Phase 0)

Input contract for the 3-tier CLI render refactor. Tiers 2 (Information Architecture) and 3 (Visual Identity) consume this document. Everything below is cited by symbol + path against `apps/cli/` as of the audit commit. Line numbers are accurate at audit time; re-grep before editing.

> **TL;DR for downstream tiers:** Rendering is *centralized* — every message, live or replayed, flows through `ingestStreamFrame` → `renderStreamItems` → `renderStreamItem` in `apps/cli/src/repl/StreamView.tsx`. But there are **two disjoint color systems**: chrome (header/footer/input) uses Ink `<Text>` props sourced from a hex palette in `theme.ts`; scrollback *content* uses hardcoded `chalk.*` ANSI styling baked into strings. There is **no path normalization** and **no semantic tool formatting** anywhere — tool args are `JSON.stringify`'d and truncated at 60 chars. No scope expansion needed: the pipeline is contained.

---

## 1. Stack identification

| Concern | Choice | Where |
|---|---|---|
| Language / module system | TypeScript 5.7 strict, ESM (`"type":"module"`, `.js` import specifiers) | `apps/cli/package.json`, `tsconfig.json` |
| TUI framework | **Ink 6.3.1** (React 19 reconciler for terminals) | `package.json` deps |
| React | 19.0.0 | `package.json` |
| Text styling (content) | **chalk 5.6.2** — ANSI string styling | imported in `render/*.ts`, `StreamView.tsx`, `ToolCallLine.tsx` |
| Spinner frames | **cli-spinners 3.4.0** (`spinners.dots`) | `useSpinnerFrame.ts`, `ToolCallLine.tsx` |
| Text input | custom (`InputBar` via Ink `useInput`). `ink-text-input` is a dep but **unused** by the REPL. | `repl/InputBar.tsx` |
| CLI arg parsing | commander 14 | `src/index.ts`, `commands/*` |
| Validation | zod (frames validated in `@harness/shared`) | shared package |

### Two rendering surfaces, one rendering core

1. **Interactive REPL** — `repl/App.tsx` renders an Ink component tree (full-screen, 5 regions). Stream content is rendered to a string, then wrapped and split into `<Text>` lines.
2. **One-shot `run` command** — `commands/run.ts` reuses the *same* `ingestStreamFrame`/`renderStreamItems` functions and writes incremental plain text to stdout (`writeIncremental`, `run.ts:146`). No Ink tree.
3. **REST replay** — `run.ts:waitForRunViaRest` (`run.ts:122`) replays persisted events through the identical `ingestStreamFrame`. **This satisfies the repo's "replay and live share one code path" rule — preserve it.** Any new render logic must live in the shared `StreamView.tsx` functions, not in `App.tsx` or `run.ts`.

### Color enable/disable

- Chrome: `createTuiTheme(env)` (`theme.ts:21`) returns a palette, or `{ noColor: true }` when `NO_COLOR` is set / `FORCE_COLOR=0` / `TERM=dumb`. The `fg`/`bg`/`border`/`inkColor` helpers (`theme.ts:50-64`) emit `{}` (no prop) when the color is `undefined`, so chrome silently de-colors.
- Content: chalk does its **own** `supports-color` detection, independent of `createTuiTheme`. So NO_COLOR is honored by both, but via two separate mechanisms — a Tier 3 consolidation point.

---

## 2. Tool-call rendering pipeline (trace)

**Event in → line rendered**, for a `sdk.tool_call` frame:

1. **Frame arrives.** `App.tsx:209` — `stream.subscribeToRun(runId, (frame) => setBuffer((current) => ingestStreamFrame(current, frame)))`. (One-shot path: `run.ts:44` `ingest`.)
2. **Reduce into buffer.** `ingestStreamFrame` (`StreamView.tsx:33`), `case "sdk.tool_call"` (`StreamView.tsx:56-72`):
   - `summary = summarizeUnknown(payload.args)` — **the raw-JSON problem.** `summarizeUnknown` (`StreamView.tsx:194`) does `JSON.stringify(value)` when not a string, then right-truncates to 60 chars with `…`.
   - Builds `StreamItem` `{ type:"tool", callId, name, status, summary?, durationMs?, error? }`.
   - Dedup by `call_id` via `findIndex` (`StreamView.tsx:59`) — a `running` item is replaced in place by its `completed`/`error` successor.
3. **Render to string.** `renderStreamItems` (`StreamView.tsx:112`) maps each item through `renderStreamItem` (`StreamView.tsx:168`), joins with `\n`. `case "tool"` → `formatToolCallLine(item)`.
4. **Format the line.** `formatToolCallLine` (`ToolCallLine.tsx:14`):
   - `marker` = `cliSpinners.dots.frames[0]` (running, **frozen frame 0 — not animated**) / `✓` (completed) / `✗` (error).
   - Returns `` `${marker} ${name}${summary}${duration}${error}` `` — **plain string, no color.**
   - The colored React component `ToolCallLine` (`ToolCallLine.tsx:22`) exists but is **dead code** — StreamView never imports it; it uses the string formatter only. It also hardcodes Ink color names `"red"/"green"/"yellow"` (not theme tokens).
5. **Viewport + wrap.** In the Ink REPL, the joined string → `renderViewportLines` (`StreamView.tsx:116`) → `hardWrapText` (`theme.ts:84`) → sliced to the scroll window → each line becomes a `<Text key>` (`StreamView.tsx:161`).

**Key finding:** there is **no tool-type dispatch**. `read`, `write`, `shell`, `grep`, etc. all render identically as `{marker} {name} {JSON-ish args}`. Subsection 1.1 (`formatToolCall`) is net-new; nothing to replace except `summarizeUnknown`'s call site at `StreamView.tsx:58`.

### Tool-call data contract (`@harness/shared`)

`toolCallEventFrameSchema` (`packages/shared/src/ws-protocol.ts:224`), `payload`:
```
call_id: string
name: string
status: "running" | "completed" | "error"
args?: unknown          // ← arbitrary; tool-specific shape, never typed
result?: unknown
truncated?: { args?: bool; result?: bool }
large_payload_refs?: { args_event_url?, result_event_url?, raw_event_url? }
timing?: { started_at?, completed_at?, duration_ms? }
```
`args` is `z.unknown()` — `formatToolCall` must defensively probe keys (`path`, `file_path`, `command`, `pattern`, `query`, `url`, …) per tool name and degrade to the generic fallback. There is no enum of tool names in shared; names are free strings originating from the SDK.

File edits also arrive as a **derived** frame: `derived.code_edit` (`ws-protocol.ts:339`), payload `codeEditDetectedPayloadSchema` (`ws-protocol.ts:324`) with `edits[]` each carrying `path`, `language`, `before?`, `after?`, `unifiedDiff?`, `operations[]`. Handled at `StreamView.tsx:73` → pushes `{type:"diff", path, diff}`. **This is the seam for 1.5** (diff/snippet previews already partially exist — see §6).

---

## 3. Message types (every distinct content type rendered)

### Stream content — `StreamItem` union (`StreamView.tsx:16-23`), styled in `renderStreamItem` (`StreamView.tsx:168`)

| Type | Source frame | Current rendering | Styled where |
|---|---|---|---|
| `assistant` | `sdk.assistant` deltas (accumulated, `StreamView.tsx:36`) | `renderMarkdown(text)` | `render/markdown.ts` (chalk) |
| user prompt | (no frame — injected locally) | `formatUserPromptBlock` → `\n❯ {text}\n\n`, stored as an `assistant` item (`App.tsx:39`, `App.tsx:187`) | plain string, **no header, no timestamp** |
| `thinking` | `sdk.thinking` deltas | `chalk.dim("◐ Thinking...\n  " + text)` (`StreamView.tsx:173`) | inline chalk.dim |
| `tool` | `sdk.tool_call` | `formatToolCallLine` (see §2) | plain string (no color) |
| `diff` | `derived.code_edit` | cyan box `┌─ path ─ … └────` wrapping `renderDiff` (`StreamView.tsx:177`) | `render/diff.ts` (chalk green/red/cyan/dim) |
| `approval` | `sdk.request` | `chalk.yellow("⚠ Approval required: … [y]es/[n]o/[a]lways")` (`StreamView.tsx:179`) | inline chalk.yellow |
| `summary` | `run.final_result` / `run.interrupted` | `renderSummary` → `─── {tokens} · {cost} · {duration} · {status} ───` (`StreamView.tsx:187`) | plain string |
| `error` | `error` frame | `chalk.red(message)` (`StreamView.tsx:183`) | inline chalk.red |

> Note `ThinkingBlock.tsx` (a React component + `formatThinking`) exists but is **not used** by StreamView — thinking is rendered inline at `StreamView.tsx:173`. Two thinking renderers, one dead. (`ThinkingBlock` has a collapsed mode the live path doesn't use.)

### Chrome (Ink components, not part of the StreamItem flow)

| Region | Component | File |
|---|---|---|
| Top header (2 rows: title+model / cwd+activity) | `HeaderBar` | `repl/HeaderBar.tsx` |
| Footer status (1 row) | `StatusBar` | `repl/StatusBar.tsx` |
| Input box (bordered, multi-line) | `InputBar` | `repl/InputBar.tsx` |
| `@`-mention popup | `MentionPopup` | `repl/MentionPopup.tsx` |
| `/`-command palette | `SlashPalette` | `repl/SlashPalette.tsx` |
| Too-small fallback | `TooSmallTerminal` | `App.tsx:344` |

---

## 4. Theme primitives

### Color palette — `createTuiTheme()` (`theme.ts:21-40`)

All hex (despite the repo-wide OKLCH convention for the *web* app; the CLI palette is hex and approximates the web tokens):

| Token | Hex | Used by |
|---|---|---|
| `background` | `#1f2530` | App/Header/Status `bg()` |
| `panel` | `#242b36` | scroll box, input box bg |
| `panelSoft` | `#2b3340` | status bar bg |
| `border` | `#66717f` | scroll box border (idle) |
| `borderFocus` | `#9bd7d8` | input box border |
| `text` | `#eef2f7` | input text |
| `muted` | `#9aa3ad` | cwd, hints, model label, scroll indicator, empty state |
| `accent` | `#9bd7d8` | `❯` prompt, chips, scroll-active border, activeLabel |
| `accentWarm` | `#d48360` | `▌ HARNESS` title |
| `warning` | `#f2c94c` | connecting/reconnecting status |
| `danger` | `#ff7a8a` | disconnected status |
| `success` | `#95d475` | connected status |
| `cyan` | `#7dd7ff` | declared, **not consumed anywhere** |

`statusColor()` (`theme.ts:42`) maps connection state → token. Helpers `fg/bg/border/inkColor` (`theme.ts:50-64`) wrap colors as Ink props, returning `{}` when undefined (NO_COLOR + `exactOptionalPropertyTypes` safety).

### The disjoint second system — hardcoded chalk

Scrollback content does **not** touch the palette above. Hardcoded chalk colors, by file:

| File | Colors used |
|---|---|
| `StreamView.tsx` | `chalk.dim` (thinking), `chalk.cyan` (diff box rule), `chalk.yellow` (approval), `chalk.red` (error) |
| `render/markdown.ts` | `chalk.underline` (link), `chalk.inverse.cyan` (inline code), `chalk.bold` (bold/heading), `chalk.italic`, `chalk.dim` (blockquote/url) |
| `render/diff.ts` | `chalk.green` (+), `chalk.red` (-), `chalk.cyan` (@@), `chalk.dim` (context, "+N more") |
| `render/code-block.ts` | `chalk.dim` (box rules) |
| `ToolCallLine.tsx` | Ink `"red"/"green"/"yellow"` (in the dead component) |

> **Subsection 1.3 + acceptance criterion 6 ("all render call-sites use named tokens, no inline color codes") target exactly this.** The migration must introduce named style tokens (e.g. `style.tool`, `style.thinking`, `style.system`, `style.error`, `style.diffAdd/Del`) and route every chalk call through them. Because content is a flat string pipeline (not Ink elements), the natural shape is a **chalk-based style module that derives its colors from `theme.ts`** — not a move to Ink `<Text>` props (that would require re-architecting StreamView away from string rendering). Tier 3 then only needs to recolor the token module.

### Typography

No weight tokens. Emphasis is ad-hoc: chalk `bold`/`dim`/`italic`/`inverse`/`underline` in content; Ink `bold`/`dimColor`/`italic` props in chrome (`HeaderBar` title `bold`, `ThinkingBlock` `dimColor italic`). Glyphs in use: `▌ ❯ ◐ ✓ ✗ ⚠ █ ┌ ─ ┐ └ ┘ │ ▼ … ⠋`. No central glyph registry — candidates for a Tier 3 token set.

---

## 5. Status bar + chrome

- **HeaderBar** (`HeaderBar.tsx`): two rows inside a `paddingX={1}` box.
  - Row 1: `▌ {title}` (accentWarm, bold) left; `{mode · model}` (muted, middle-truncated to `rightWidth`) right.
  - Row 2: `cwd {cwd}` (muted, middle-truncated to `leftWidth`) left; `{activity}` (status-colored) right, where activity = `{spinner} running {runId8}` / `{n} queued` / `ready`.
  - `title` collapses `Cursor Harness` → `HARNESS` below 84 cols.
- **StatusBar** (`StatusBar.tsx`): single row, `panelSoft` bg, all `muted`. Builds a `·`-joined detail string then `truncateMiddle`s to width. Compact (`width < 120`) drops the model+runState and shortens keybind hints. Exports `formatStatusBar` (a *different*, `│`-joined format) used only by tests — **drift between the test format and the live `StatusBar` render**; flag for Tier 2.
- **InputBar** (`InputBar.tsx`): rounded border (`borderFocus`), `panel` bg. Renders chips `[@label]` on line 0, `❯ ` prompt gutter (accent) / `  ` continuation, placeholder when empty, trailing `█` cursor block. Bounded to `maxVisibleLines` with a `…` hidden-line indicator.
- **Overlays**: `MentionPopup` and `SlashPalette` render between the scroll box and InputBar (`App.tsx:301-302`), height-budgeted via `overlayLineCount` (`App.tsx:74`).

> **Header/Status duplication** (cwd, model, mode, connection, runState all appear in *both*) is explicitly **Tier 2 scope** — do not dedup here. Logged in `NOTES.md`.

### Layout math — `computeTuiLayout` (`layout.ts:28`)

`headerHeight=2`, `footerHeight=1`, `inputHeight=min(6, max(3, lines+2))`, `overlayHeight=min(9, …)`, `scrollHeight = rows − header − footer − input − overlay`. `canRender` requires `≥ 60×16` (`theme.ts:1-2` `MIN_COLUMNS/MIN_ROWS`). StreamView gets `height = scrollHeight − 2`, `width = columns − 4` (`App.tsx:76-77`).

---

## 6. Truncation logic

| Function | File | Strategy | Used by | Spec-compliant for paths (1.4)? |
|---|---|---|---|---|
| `truncateMiddle(input, maxWidth)` | `theme.ts:66` | **middle** ellipsis, ANSI-aware via `visibleLength` | HeaderBar cwd/model, StatusBar line | ✅ this is the primitive 1.4 wants for the "neither cwd nor home" case |
| `hardWrapText(input, width)` | `theme.ts:84` | word-wrap; **strips ANSI when a line exceeds width** (`theme.ts:88`) | StreamView viewport, InputBar | ⚠️ see warning below |
| `truncate(value, maxWidth)` | `output/table.ts:10` | **right** truncate | table cells | ✗ right-truncation — wrong for paths |
| `firstLine(value, maxWidth)` | `output/table.ts:48` | first line + right-truncate | non-interactive commands | — |
| `summarizeUnknown(value)` | `StreamView.tsx:194` | `JSON.stringify` + **right** truncate @ 60 | tool args (to be replaced by 1.1) | ✗ |
| code-block line clip | `render/code-block.ts:25` | right-clip with `…` to inner width | code fences | — |
| `renderDiff` maxLines | `render/diff.ts:9` | slice to N lines + "+N more" | diffs | — (line-count cap, not width) |

> **⚠️ ANSI-loss-on-wrap bug (audit finding, not in 4 PR scope but affects 1.3/1.5):** `hardWrapText` (`theme.ts:88`) replaces any over-width line with its `stripAnsi`'d form *before* wrapping, so **colored content longer than the viewport width loses all color**. Since 1.3 routes everything through chalk and 1.5 emits multi-line colored diffs, wide colored lines will render uncolored. Two options: (a) make `hardWrapText` ANSI-aware so codes survive wrapping, or (b) wrap *before* coloring. Logged in `NOTES.md`; may force a decision during 1.5.

---

## Subsection readiness map (what exists vs. net-new)

| Sub | Status | Notes |
|---|---|---|
| 1.1 semantic tool calls | **net-new** | replace `summarizeUnknown` call at `StreamView.tsx:58`; add `formatToolCall(name, args, cwd)`. No tool dispatch exists today. |
| 1.2 turn boundaries | **net-new** | only `formatUserPromptBlock` (`❯ text`) + `renderSummary` footer exist. No `── you · HH:MM ──` / `── claude ──`. Footer format differs from spec. |
| 1.3 typographic hierarchy / tokens | **partial → refactor** | palette exists for chrome; content is hardcoded chalk. Must add a token module and migrate ~5 files' chalk call-sites. |
| 1.4 `normalizePath` | **net-new** | no path normalization anywhere; `truncateMiddle` is a reusable primitive for the abs-path case. |
| 1.5 diff/snippet previews | **partial** | `renderDiff` + `derived.code_edit` → diff item already render unified diffs (max 20 lines). Missing: new-file `+ ` first-5-lines, 15-line cap w/ 5 context, binary `wrote {file} ({size})`, syntax color. Also `write`/`edit` *tool calls* don't themselves preview — only the derived frame does. |
| 1.6 streaming indicators | **net-new** | per-tool marker is frozen `frames[0]`; only the global `activeLabel` animates (`useSpinnerFrame.ts`). No per-tool timer, no shell stdout tail, no per-tool cancelled state. |

## Verification step (per-commit gate)

Per `CLAUDE.md`: a change is green only when `pnpm typecheck && pnpm lint && pnpm test` pass. Scoped to this package: `pnpm -F @harness/cli typecheck`, `eslint apps/cli`, `pnpm -F @harness/cli test` (vitest). Existing CLI tests are **pure unit tests on exported string helpers** (`tests/repl/*.test.tsx`, `tests/render/*`) — so `formatToolCall` and `normalizePath` should be exported pure functions to stay testable in that style. ESLint rule `harness/no-use-effect-in-components` applies to web only; CLI hooks (`useSpinnerFrame`) legitimately use `useEffect`.

## Out-of-scope items spotted (→ `NOTES.md`)

- Header/Status field duplication (Tier 2).
- `StatusBar.formatStatusBar` vs live render format drift (Tier 2).
- Dead code: `ToolCallLine` React component, `ThinkingBlock`/`formatThinking`, unused `theme.cyan`, unused `ink-text-input` dep.
- ANSI-loss-on-wrap in `hardWrapText` (cross-cutting; may surface during 1.5).
- Palette is hex in CLI vs OKLCH convention elsewhere (Tier 3 color decision).

## Drift since Tier 1

Phase 0-light for Tier 2 re-verified the audit on 2026-05-27. The cited chrome components still exist at `apps/cli/src/repl/HeaderBar.tsx`, `apps/cli/src/repl/StatusBar.tsx`, and `apps/cli/src/repl/InputBar.tsx`, but the audit's "no path normalization" / "no style token" findings are stale after Tier 1 implementation.

Current Tier 1 state:

- `apps/cli/src/render/styles.ts` defines named render tokens (`styles.tool`, `styles.system`, `styles.error`, `styles.diffAdd`, etc.) and migrated scrollback render call-sites through that token module.
- `apps/cli/src/render/path.ts` defines `normalizePath(absPath, cwd)` with home-relative and cwd-relative display rules.
- `apps/cli/src/render/tool-call.ts` formats semantic tool summaries and normalizes path-like tool arguments.
- `apps/cli/src/repl/StreamView.tsx` now accepts `cwd` in `ingestStreamFrame`, normalizes `derived.code_edit` paths, renders user/assistant turn boundaries, suppresses running tools into the active overlay, and labels final turn cost as `turn $...` in the scrollback footer.
- `apps/cli/src/repl/HeaderBar.tsx` still renders the raw workspace string instead of `normalizePath`; Tier 2.1 should move top-header cwd display onto `normalizePath(workspace, process.cwd())`.
- `apps/cli/src/repl/StatusBar.tsx` still duplicates cwd/model/mode/run-state/connection with header chrome and still exposes websocket jargon (`ws ...`); this remains Tier 2 scope.
- There is no active account/profile field in CLI preferences (`~/.harness-cli/config.json` currently stores `lastAgentId`, `preferredMode`, and `preferredModel` only). Tier 2.2 should flag account/profile as an assumption or use an explicit fallback label without building multi-account support.
- Live streaming frames expose token/cost usage only at `run.final_result`; `sdk.assistant`, `sdk.status`, and tool frames do not carry usage deltas. Tier 2.4 should not ship a fake live counter without backend instrumentation or an explicitly accepted heuristic.
