# CLI Theme (Repl)

## Color tokens (source of truth: `src/repl/theme.ts`)

- `background`, `panel`, `panelSoft`: transparent sentinels, so chrome surfaces stay mostly neutral to the terminal theme.
- `border`: muted separator gray (`#66717f`).
- `text`: foreground base (`#eef2f7`).
- `muted`: muted text (`#9aa3ad`).
- `brand`: warm accent / identity (`#E04E1F`, default vermillion).
- `code`: code text helper (`#7dd7ff`).
- `state.ready`: success/idle signal color.
- `state.running`: running/working signal color (soft amber).
- `state.success`: done/final success signal color.
- `state.error`: error/cancel/failure signal color.

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
- Overlay frames (mention/syntax palettes): `theme.state.ready` on focus, `border` otherwise.

## Vertical rhythm

The stream renderer groups output by blocks and inserts one blank line between transitions:

- user block → assistant block → thinking block → tool sequence → assistant block …
- tool lines (`tool` + `diff`) are kept contiguous (no blank lines inside a tool sequence).
- run summary (meta) is separated from prior content by one blank line.

`formatTurnHeader("you", ...)` and `formatTurnHeader("claude", ...)` own their surrounding separators.
