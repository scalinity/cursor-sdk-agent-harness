import {
  terminalServerFrameSchema,
  type TerminalClientFrame,
  type TerminalServerFrame,
} from "@harness/shared";

/**
 * Client-side framing for the `/ws/terminal` channel. Kept separate from the
 * xterm/WebSocket wiring in `useTerminalSession` so the wire contract is unit-
 * testable without a DOM or a canvas.
 */

export function serializeTerminalInput(data: string): string {
  const frame: TerminalClientFrame = { type: "input", data };
  return JSON.stringify(frame);
}

export function serializeTerminalResize(cols: number, rows: number): string {
  const frame: TerminalClientFrame = { type: "resize", cols, rows };
  return JSON.stringify(frame);
}

/** Parse + validate an inbound server frame. Returns null on malformed input. */
export function parseTerminalServerFrame(raw: string): TerminalServerFrame | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = terminalServerFrameSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
