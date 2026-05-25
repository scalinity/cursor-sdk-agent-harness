import { z } from "zod";

/**
 * Embedded-terminal wire protocol.
 *
 * This is a deliberately separate, lightweight channel from the run-event
 * protocol in `ws-protocol.ts`. Terminal I/O is ephemeral raw PTY bytes — it
 * is NEVER persisted to the `events` table or routed through `RunBus`, so it
 * does not share the `subscribe_run` envelope (`id`/`sent_at`/`replayed`) or
 * the per-run subscription model. Frames are small JSON objects discriminated
 * on `type`, validated at the `/ws/terminal` boundary.
 *
 * Field names are snake_case to match the run protocol's wire convention.
 */

/**
 * Upper bound on a single client `input` frame's `data` length (characters).
 * Generous enough for a large paste, bounded so a pathological frame can't
 * force an unbounded allocation. 1 MiB of UTF-16 chars.
 */
export const MAX_TERMINAL_INPUT_CHARS = 1_048_576;

/**
 * Upper bound on a single server `data` frame's `data` length (characters).
 * The session chunks PTY output well below this; the cap is a safety net for
 * the schema validator.
 */
export const MAX_TERMINAL_OUTPUT_CHARS = 2_097_152;

/** PTY viewport bounds. xterm/fit never produces anything near these. */
export const MIN_TERMINAL_DIMENSION = 1;
export const MAX_TERMINAL_DIMENSION = 2_000;

const terminalDimensionSchema = z
  .number()
  .int()
  .min(MIN_TERMINAL_DIMENSION)
  .max(MAX_TERMINAL_DIMENSION);

// -- Client → Server frames -------------------------------------------------

export const terminalInputFrameSchema = z.object({
  type: z.literal("input"),
  /** Raw keystrokes / pasted text, UTF-8. Written verbatim to the PTY. */
  data: z.string().max(MAX_TERMINAL_INPUT_CHARS),
});

export const terminalResizeFrameSchema = z.object({
  type: z.literal("resize"),
  cols: terminalDimensionSchema,
  rows: terminalDimensionSchema,
});

export const terminalClientFrameSchema = z.discriminatedUnion("type", [
  terminalInputFrameSchema,
  terminalResizeFrameSchema,
]);
export type TerminalClientFrame = z.infer<typeof terminalClientFrameSchema>;

// -- Server → Client frames -------------------------------------------------

export const terminalReadyFrameSchema = z.object({
  type: z.literal("ready"),
  cols: terminalDimensionSchema,
  rows: terminalDimensionSchema,
  /** Absolute directory the shell was spawned in (realpath-resolved). */
  cwd: z.string(),
});

export const terminalDataFrameSchema = z.object({
  type: z.literal("data"),
  /** Raw PTY output bytes decoded as UTF-8. */
  data: z.string().max(MAX_TERMINAL_OUTPUT_CHARS),
});

export const terminalExitFrameSchema = z.object({
  type: z.literal("exit"),
  /** Process exit code, or null when terminated by a signal. */
  code: z.number().int().nullable(),
  /** Terminating signal number, when applicable. */
  signal: z.number().int().nullable().optional(),
});

export const terminalErrorFrameSchema = z.object({
  type: z.literal("error"),
  message: z.string().max(2_000),
});

export const terminalServerFrameSchema = z.discriminatedUnion("type", [
  terminalReadyFrameSchema,
  terminalDataFrameSchema,
  terminalExitFrameSchema,
  terminalErrorFrameSchema,
]);
export type TerminalServerFrame = z.infer<typeof terminalServerFrameSchema>;
