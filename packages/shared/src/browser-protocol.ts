import { z } from "zod";
import { agentIdSchema, isoDateTimeSchema } from "./constants.js";

/**
 * Phase 18 — Embedded Chromium browser pane protocol.
 *
 * Three boundaries live here, all Zod-first (inferred types only):
 *
 *  1. **Renderer ⇄ main IPC** (`browser:*` channels). The Electron renderer
 *     reports the placeholder rect and drives manual navigation; the main
 *     process pushes state + action-overlay events back. See
 *     `apps/desktop/src/browser-ipc.ts` + `apps/web/src/lib/desktop-bridge.ts`.
 *  2. **Built-in browser MCP tool surface**. Input/output schemas for the ten
 *     `browser_*` tools the agent calls through the `harness_browser` MCP
 *     server. These results become standard `tool_call` event payloads.
 *  3. **REST projections** for the browser state / console / network polling
 *     endpoints consumed by the renderer drawers.
 *
 * `BrowserId` is the agent id for v1 — each agent owns exactly one isolated
 * Electron `session.fromPartition('persist:agent-<agentId>')`. No partition is
 * reused across agents (spec §10 session isolation).
 *
 * Convention: camelCase throughout. Unlike `ws-protocol.ts` (snake_case wire
 * frames mirroring spec §7) and the SQL row projections (snake_case columns),
 * this surface is internal IPC + a fresh MCP tool contract with no persisted
 * column or spec-pinned frame to mirror, so it follows the TypeScript-side
 * camelCase default.
 */

// -- Identity ---------------------------------------------------------------

/** A browser instance is keyed by its owning agent id (BrowserId = agentId). */
export const browserIdSchema = agentIdSchema;
export type BrowserId = z.infer<typeof browserIdSchema>;

// -- Geometry ---------------------------------------------------------------

/**
 * CSS-pixel rect the renderer reports for its placeholder div. The main
 * process translates these into the BrowserWindow content-area coordinates
 * before calling `WebContentsView.setBounds()`. A zero-area rect means
 * "hide the view" (the renderer reports this when the Browser tab is not
 * active or the right pane is collapsed).
 */
export const browserRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
export type BrowserRect = z.infer<typeof browserRectSchema>;

// -- Navigation -------------------------------------------------------------

export const waitConditionSchema = z.enum(["load", "domcontentloaded", "networkidle"]);
export type WaitCondition = z.infer<typeof waitConditionSchema>;

/**
 * Live state of one browser, surfaced to the URL bar + status strip and the
 * `GET /api/browser/:agentId/state` endpoint. `exists: false` means no
 * `WebContentsView` has been created for this agent yet (lazy creation).
 */
export const browserStateSchema = z.object({
  agentId: browserIdSchema,
  exists: z.boolean(),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  /** Last action description for the status strip, e.g. "navigate example.com". */
  lastAction: z.string().nullable(),
});
export type BrowserState = z.infer<typeof browserStateSchema>;

// -- Console + network ring buffers -----------------------------------------

export const consoleLevelSchema = z.enum(["log", "info", "warn", "error", "debug"]);
export type ConsoleLevel = z.infer<typeof consoleLevelSchema>;

export const consoleMessageSchema = z.object({
  /** Monotonic per-browser sequence; the polling `since` cursor uses it. */
  seq: z.number().int().nonnegative(),
  level: consoleLevelSchema,
  text: z.string(),
  source: z.string().optional(),
  lineNumber: z.number().int().optional(),
  at: isoDateTimeSchema,
});
export type ConsoleMessage = z.infer<typeof consoleMessageSchema>;

export const networkRequestSchema = z.object({
  seq: z.number().int().nonnegative(),
  url: z.string(),
  method: z.string(),
  resourceType: z.string().optional(),
  statusCode: z.number().int().optional(),
  fromCache: z.boolean().optional(),
  at: isoDateTimeSchema,
});
export type NetworkRequest = z.infer<typeof networkRequestSchema>;

// -- Accessibility tree (agent's primary affordance) ------------------------

/**
 * A node in the snapshot accessibility tree. Each interactable node carries a
 * `ref` (`data-aria-ref` attribute injected at snapshot time) — `browser_click`
 * and `browser_type` accept ONLY these refs, never raw CSS selectors. This
 * mirrors Playwright MCP / Claude-in-Chrome and is non-negotiable (selector
 * clicking is fragile).
 */
export interface AccessibilityNode {
  ref: string;
  role: string;
  name?: string | undefined;
  value?: string | undefined;
  children?: AccessibilityNode[] | undefined;
}
export const accessibilityNodeSchema: z.ZodType<AccessibilityNode> = z.lazy(() =>
  z.object({
    ref: z.string(),
    role: z.string(),
    name: z.string().optional(),
    value: z.string().optional(),
    children: z.array(accessibilityNodeSchema).optional(),
  }),
);

// -- Action-overlay events (main → renderer push) ---------------------------

/**
 * Emitted by the main process when the agent (or manual UI) performs a visible
 * action, so the renderer can draw the amber highlight / shutter flash / URL
 * spinner. `rect` is in the same CSS-pixel space the renderer reported, already
 * translated back from content-area coords.
 */
export const browserActionEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), ref: z.string(), rect: browserRectSchema }),
  z.object({ type: z.literal("type"), ref: z.string(), rect: browserRectSchema }),
  z.object({ type: z.literal("screenshot") }),
  z.object({ type: z.literal("navigate"), url: z.string() }),
]);
export type BrowserActionEvent = z.infer<typeof browserActionEventSchema>;

// -- MCP tool input/output schemas ------------------------------------------
// The agent calls these via the `harness_browser` MCP server. Inputs are
// validated before reaching BrowserController; outputs become the
// `tool_call.completed` result payload.

export const browserNavigateInputSchema = z.object({
  url: z.string().min(1),
  waitUntil: waitConditionSchema.optional(),
});
export const browserNavigateOutputSchema = z.object({
  url: z.string(),
  status: z.number().int().nullable(),
  redirected: z.boolean(),
});

export const browserScreenshotInputSchema = z.object({
  fullPage: z.boolean().optional(),
});
export const browserScreenshotOutputSchema = z.object({
  imagePath: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
});

export const browserSnapshotInputSchema = z.object({});
export const browserSnapshotOutputSchema = z.object({
  tree: z.array(accessibilityNodeSchema),
  url: z.string(),
  title: z.string(),
});

export const browserClickInputSchema = z.object({ ref: z.string().regex(/^e\d+$/, "ref must match /^e\\d+$/ from a prior browser_snapshot") });
export const browserClickOutputSchema = z.object({
  clicked: z.literal(true),
  urlAfter: z.string(),
  ms: z.number().int().nonnegative(),
});

export const browserTypeInputSchema = z.object({
  ref: z.string().regex(/^e\d+$/, "ref must match /^e\\d+$/ from a prior browser_snapshot"),
  text: z.string(),
  submit: z.boolean().optional(),
});
export const browserTypeOutputSchema = z.object({
  typed: z.literal(true),
  valueAfter: z.string(),
});

export const browserEvaluateInputSchema = z.object({ expression: z.string().min(1) });
export const browserEvaluateOutputSchema = z.object({
  value: z.unknown(),
  error: z.string().optional(),
});

export const browserConsoleMessagesInputSchema = z.object({
  levels: z.array(consoleLevelSchema).optional(),
  since: z.number().int().nonnegative().optional(),
});
export const browserConsoleMessagesOutputSchema = z.array(consoleMessageSchema);

export const browserNetworkRequestsInputSchema = z.object({
  filter: z.string().optional(),
  since: z.number().int().nonnegative().optional(),
});
export const browserNetworkRequestsOutputSchema = z.array(networkRequestSchema);

export const browserWaitForInputSchema = z
  .object({
    text: z.string().optional(),
    ref: z.string().regex(/^e\d+$/, "ref must match /^e\\d+$/ from a prior browser_snapshot").optional(),
    ms: z.number().int().nonnegative().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .refine((v) => v.text !== undefined || v.ref !== undefined || v.ms !== undefined, {
    message: "browser_wait_for requires at least one of: text, ref, ms",
  });
export const browserWaitForOutputSchema = z.object({
  matched: z.boolean(),
  ms: z.number().int().nonnegative(),
});

export const browserHistoryOutputSchema = z.object({ url: z.string() });

// -- Renderer → main IPC request union (channel `browser:invoke`) -----------
// Manual driving + lifecycle. Programmatic agent actions also route through
// the same BrowserController but are invoked in-process by the MCP server
// (no Electron IPC), so they are NOT part of this renderer-facing union.

export const browserInvokeRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("ensure"), agentId: browserIdSchema }),
  z.object({ op: z.literal("position"), agentId: browserIdSchema, rect: browserRectSchema }),
  z.object({ op: z.literal("hide"), agentId: browserIdSchema }),
  z.object({
    op: z.literal("navigate"),
    agentId: browserIdSchema,
    url: z.string().min(1),
  }),
  z.object({ op: z.literal("back"), agentId: browserIdSchema }),
  z.object({ op: z.literal("forward"), agentId: browserIdSchema }),
  z.object({ op: z.literal("reload"), agentId: browserIdSchema }),
  z.object({ op: z.literal("stop"), agentId: browserIdSchema }),
  z.object({ op: z.literal("getState"), agentId: browserIdSchema }),
  z.object({ op: z.literal("destroy"), agentId: browserIdSchema }),
]);
export type BrowserInvokeRequest = z.infer<typeof browserInvokeRequestSchema>;

/** Result envelope for a `browser:invoke` round-trip. */
export const browserInvokeResultSchema = z.union([
  z.object({ ok: z.literal(true), state: browserStateSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type BrowserInvokeResult = z.infer<typeof browserInvokeResultSchema>;

/** Main → renderer push payload on channel `browser:event`. */
export const browserPushEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state"), agentId: browserIdSchema, state: browserStateSchema }),
  z.object({ kind: z.literal("action"), agentId: browserIdSchema, action: browserActionEventSchema }),
]);
export type BrowserPushEvent = z.infer<typeof browserPushEventSchema>;
