# CLI Theme (Repl)

## Visual identity decisions

- Brand accent is vermillion `#E04E1F`; use it only for identity surfaces: the CLI title, turn header separators, focused input frame, prompt indicator, and other explicitly branded labels.
- State colors stay cool/semantic: ready/success is muted green, running/thinking is soft amber, and failures are red. Do not use state colors as decoration.
- Neutral grays carry terminal structure: body text is off-white, secondary text is gray, and default frames/separators are muted gray.
- Chrome backgrounds are transparent sentinels; the host terminal should remain the canvas instead of adding slab-like filled panels.
- Selection in overlays is an active-row state, not completion or running. Use `●` in `state.ready` for the selected row, with neutral overlay borders.
- `NO_COLOR`, `FORCE_COLOR=0`, and `TERM=dumb` must remove color while preserving glyphs, spacing, labels, and borders.

## Color tokens (source of truth: `src/repl/theme.ts`)

- `background`, `panel`, `panelSoft`: transparent sentinels, so chrome surfaces stay mostly neutral to the terminal theme.
- `border`: muted separator gray (`#66717f`).
- `text`: foreground base (`#eef2f7`).
- `muted`: muted text (`#9aa3ad`).
- `brand`: warm accent / identity (`#E04E1F`, default vermillion).
- `code`: code text helper (`#7dd7ff`).
- `state.ready`: success/idle signal color (`#95d475`).
- `state.running`: running/working signal color (soft amber, `#f2c94c`).
- `state.success`: done/final success signal color (`#95d475`).
- `state.error`: error/cancel/failure signal color (`#ff7a8a`).

`createTuiTheme()` also honors:
- `NO_COLOR` (`ANY`), `FORCE_COLOR=0`, and `TERM=dumb` by returning `{ noColor: true }`.

## Glyph vocabulary

- `glyph.running` = `▸`
- `glyph.done` = `✓`
- `glyph.failed` = `✗`
- `glyph.paused` = `⏸`
- `glyph.retry` = `↺`
- `glyph.thinking` = `◐`
- `glyph.readyDot` = `●`

The live thinking/boot spinner animates `thinkingSpinnerFrames` (`◐`, `◑`, `◒`, `◓`) — quarter-circle variants of `glyph.thinking` only. Do not use Braille dot frames in the REPL.

Allowed non-state glyphs (layout/information only; keep stable by rule):

- `─`, `┌`, `└`, `│` (frame and diff box borders)
- `▼`, `↑`, `↓` (scroll controls)
- `…` and `·` in compact status separators
- `|`, `·` separators and `:` labels
- turn header separator prefix/suffix (`──`)
- box-trace markers from renderers (`+`, `-`, `@@`, etc. from unified diffs)

## State mapping

- Running/tool output and runtime indicators: `state.running`
- Completed/final states: `state.success`
- Idle/ready states: `state.ready`
- Failures/errors/alerts: `state.error`

## Border rules

- Scrollback frame: `border` in the neutral state.
- Input frame: `brand` when focused, `border` when not focused.
- Overlay frames (mention/syntax palettes): always `border`; the selected row uses `state.ready` on `glyph.readyDot` only.
- Streaming a response shifts focus to output, so the input frame dims to `border` while the active label uses `state.running`.

## Vertical rhythm

The stream renderer groups output by blocks and inserts one blank line between transitions:

- user block → assistant block → thinking block → tool sequence → assistant block …
- tool lines (`tool` + `diff`) are kept contiguous (no blank lines inside a tool sequence).
- run summary (meta) is separated from prior content by one blank line.

`formatTurnHeader("you", ...)` and `formatTurnHeader("claude", ...)` own their surrounding separators.
