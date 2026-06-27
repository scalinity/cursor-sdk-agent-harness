// Mouse-wheel scrolling for the alternate-screen REPL.
//
// In alternate-screen mode the terminal's native scrollback is disabled, so a
// wheel turn does nothing by default — older transcript content scrolls off and
// feels "lost". We opt the terminal into mouse reporting and translate wheel
// notches into the same scroll offset the keyboard already drives.
//
// We enable button tracking (1000) so wheel notches arrive as buttons 64/65,
// plus SGR extended mode (1006) for unambiguous, coordinate-safe parsing.
// Motion tracking (1002/1003) is intentionally left OFF: we only want wheel and
// click press/release, not a flood of move events on every cursor twitch.
//
// NB: while mouse reporting is on, the terminal hands click/drag to the app
// instead of doing native text selection. Most terminals still allow a
// modifier-drag (Option on macOS, Shift elsewhere) to select text the old way.
export const ENABLE_MOUSE = "\u001b[?1000h\u001b[?1006h";
export const DISABLE_MOUSE = "\u001b[?1006l\u001b[?1000l";

// Lines moved per wheel notch — matches the feel of `less`/pagers rather than
// the single-line keyboard step, since a wheel turn implies coarser intent.
export const WHEEL_LINES_PER_NOTCH = 3;

// SGR mouse report: "ESC [ < b ; x ; y (M|m)". Ink strips the leading ESC before
// handing input to `useInput`, so the match anchors on "[<" rather than ESC.
// A global scan naturally skips any ESC between batched reports, so multiple
// notches in one chunk are all captured (see parseMouseWheel). Avoiding a literal
// ESC in the pattern also keeps us clear of eslint's no-control-regex.
const SGR_MOUSE_RE = /\[<(\d+);\d+;\d+[Mm]/g;
// Legacy X10 reports ("[M" + 3 raw bytes) only appear if a terminal ignores the
// 1006 request. We can't reliably decode wheel direction from utf8-mangled bytes,
// so we recognize the prefix purely to swallow it (never inject it as text).
const LEGACY_MOUSE_RE = /\[M/;

export interface MouseWheelResult {
  /** Net vertical wheel notches: positive = scroll up (older), negative = down. */
  notches: number;
}

/**
 * Detect a mouse report inside a keypress chunk.
 *
 * Returns `null` when the input is ordinary text (callers should treat it as
 * such). Returns a result — with the net wheel notches, `0` for clicks — when
 * the input is a mouse sequence, so callers can both act on the wheel and
 * swallow the bytes before they leak into a text field.
 */
export function parseMouseWheel(input: string): MouseWheelResult | null {
  if (!input || input.indexOf("[") === -1) return null;
  let isMouse = false;
  let notches = 0;
  SGR_MOUSE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SGR_MOUSE_RE.exec(input)) !== null) {
    isMouse = true;
    const button = Number(match[1]);
    // Bit 6 (value 64) flags a wheel event; the low two bits give the axis:
    // 0 = up, 1 = down, 2/3 = horizontal tilt (ignored). Modifier bits (shift/
    // meta/ctrl) ride in higher bits and are masked away by `& 3`.
    if ((button & 64) !== 0) {
      const direction = button & 3;
      if (direction === 0) notches += 1;
      else if (direction === 1) notches -= 1;
    }
  }
  if (isMouse) return { notches };
  if (LEGACY_MOUSE_RE.test(input)) return { notches: 0 };
  return null;
}
