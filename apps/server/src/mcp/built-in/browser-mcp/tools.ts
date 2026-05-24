import { z } from "zod";
import {
  browserNavigateInputSchema,
  browserScreenshotInputSchema,
  browserSnapshotInputSchema,
  browserClickInputSchema,
  browserTypeInputSchema,
  browserEvaluateInputSchema,
  browserConsoleMessagesInputSchema,
  browserNetworkRequestsInputSchema,
} from "@harness/shared";

// browser_wait_for's shared schema carries a cross-field `.refine` (at least
// one of text/ref/ms), so it's a ZodEffects without `.shape`. MCP inputSchema
// wants a raw shape, so we declare it inline here; the at-least-one rule is
// enforced by the backend (BrowserController.waitFor).
const browserWaitForShape = {
  text: z.string().optional(),
  ref: z.string().optional(),
  ms: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
};
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBrowserBackend } from "./backend.js";

/**
 * Registers the ten `browser_*` tools on an `McpServer`, each bound to a single
 * `agentId` (one isolated browser session per agent). Tool calls reach the
 * Electron `BrowserController` through the injected `BrowserBackend`. The
 * descriptions tell the model to call `browser_snapshot` before `browser_click`
 * / `browser_type` (clicking by guess without seeing the accessibility tree is
 * fragile) and that `document.cookie` reads are redacted.
 */
export function registerBrowserTools(server: McpServer, agentId: string): void {
  const ok = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  const fail = (message: string) => ({
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  });
  const guard = async <T>(fn: () => Promise<T>) => {
    try {
      return ok(await fn());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };

  server.registerTool(
    "browser_navigate",
    {
      description:
        "Navigate the agent's browser to a URL and wait for it to load. Use this to open a page before inspecting or interacting with it. Returns the final URL (after redirects) and HTTP status.",
      inputSchema: browserNavigateInputSchema.shape,
    },
    async (args) => guard(() => getBrowserBackend().navigate(agentId, args.url, args.waitUntil)),
  );

  server.registerTool(
    "browser_snapshot",
    {
      description:
        "Capture the current page's accessibility tree. Each interactable node has a `ref` id. ALWAYS call this before browser_click or browser_type so you click real elements by ref rather than guessing selectors. Returns the tree plus the page url and title.",
      inputSchema: browserSnapshotInputSchema.shape,
    },
    async () => guard(() => getBrowserBackend().snapshot(agentId)),
  );

  server.registerTool(
    "browser_click",
    {
      description:
        "Click an element by its `ref` from a prior browser_snapshot. Refs are required — selectors are not accepted because they break. Returns the url after the click and how long it took.",
      inputSchema: browserClickInputSchema.shape,
    },
    async (args) => guard(() => getBrowserBackend().click(agentId, args.ref)),
  );

  server.registerTool(
    "browser_type",
    {
      description:
        "Type text into an input identified by its `ref` from a prior browser_snapshot. Set submit:true to press Enter afterward (e.g. to submit a search). Returns the field value after typing.",
      inputSchema: browserTypeInputSchema.shape,
    },
    async (args) => guard(() => getBrowserBackend().type(agentId, args.ref, args.text, args.submit)),
  );

  server.registerTool(
    "browser_screenshot",
    {
      description:
        "Capture a PNG screenshot of the current page (set fullPage:true for the whole scrollable page). Saves the image and returns its path and dimensions; fetch the image lazily by path.",
      inputSchema: browserScreenshotInputSchema.shape,
    },
    async (args) => guard(() => getBrowserBackend().screenshot(agentId, args.fullPage)),
  );

  server.registerTool(
    "browser_evaluate",
    {
      description:
        "Evaluate a JavaScript expression in the page and return its value. NOTE: document.cookie reads return \"[REDACTED]\" — cookie values are never exposed to the agent. Use for reading DOM text/state, not for extracting secrets.",
      inputSchema: browserEvaluateInputSchema.shape,
    },
    async (args) => guard(() => getBrowserBackend().evaluate(agentId, args.expression)),
  );

  server.registerTool(
    "browser_console_messages",
    {
      description:
        "Return recent browser console messages (optionally filtered by level, or since a sequence cursor). Use to debug page errors after navigation or interaction.",
      inputSchema: browserConsoleMessagesInputSchema.shape,
    },
    async (args) =>
      guard(() => getBrowserBackend().consoleMessages(agentId, args.levels, args.since)),
  );

  server.registerTool(
    "browser_network_requests",
    {
      description:
        "Return recent network requests the page made (optionally filtered by URL substring, or since a sequence cursor). Use to inspect API calls or resource loads.",
      inputSchema: browserNetworkRequestsInputSchema.shape,
    },
    async (args) =>
      guard(() => getBrowserBackend().networkRequests(agentId, args.filter, args.since)),
  );

  server.registerTool(
    "browser_wait_for",
    {
      description:
        "Wait until a condition holds: text appears on the page, an element ref exists, or a fixed number of milliseconds elapses (at least one of text/ref/ms is required). Use after an action that triggers async updates.",
      inputSchema: browserWaitForShape,
    },
    async (args) =>
      guard(() =>
        getBrowserBackend().waitFor(agentId, {
          ...(args.text !== undefined ? { text: args.text } : {}),
          ...(args.ref !== undefined ? { ref: args.ref } : {}),
          ...(args.ms !== undefined ? { ms: args.ms } : {}),
          ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        }),
      ),
  );

  server.registerTool(
    "browser_back",
    { description: "Go back one entry in the browser history. Returns the resulting url.", inputSchema: {} },
    async () => guard(() => getBrowserBackend().back(agentId)),
  );
  server.registerTool(
    "browser_forward",
    { description: "Go forward one entry in the browser history. Returns the resulting url.", inputSchema: {} },
    async () => guard(() => getBrowserBackend().forward(agentId)),
  );
  server.registerTool(
    "browser_reload",
    { description: "Reload the current page. Returns the url.", inputSchema: {} },
    async () => guard(() => getBrowserBackend().reload(agentId)),
  );
}
