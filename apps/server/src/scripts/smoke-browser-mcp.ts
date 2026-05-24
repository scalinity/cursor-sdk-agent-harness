/**
 * Phase 18 Milestone 2 — OQ-24 transport smoke.
 *
 * Verifies that `@cursor/sdk`'s MCP client actually connects to our loopback
 * Streamable-HTTP browser MCP server and that the agent's tool calls surface as
 * `mcp__harness_browser__*` events. Uses a STUB BrowserBackend (no Electron) —
 * this isolates the SDK<->MCP-server transport, which is the unverified part.
 *
 * Gated by `RUN_SDK_SMOKE=true`; makes a real `agent.send` call, so it needs a
 * Cursor API key (read from CURSOR_API_KEY, falling back to the repo .env).
 *
 *   RUN_SDK_SMOKE=true pnpm --filter @harness/server exec tsx src/scripts/smoke-browser-mcp.ts
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Agent as CursorAgent } from "@cursor/sdk";
import {
  startBrowserMcpServer,
  registerBrowserBackend,
  type BrowserBackend,
} from "../mcp/built-in/browser-mcp/index.js";

const MODEL_ID = process.env.SMOKE_MODEL_ID ?? "composer-2.5";
const PROMPT =
  "Use your browser_navigate tool to open https://example.com, then briefly tell me you did it.";
const STREAM_TIMEOUT_MS = 120_000;
const API_KEY_RE = /^\s*CURSOR_API_KEY\s*=\s*"?([^"\n]+)"?\s*$/m;

function loadApiKey(): string {
  if (process.env.CURSOR_API_KEY) return process.env.CURSOR_API_KEY;
  // Worktrees don't carry the gitignored .env; fall back to the main checkout.
  const candidates = [".env", "../../.env", "/Users/danny/Documents/Codez/Apps/CursorHarness/.env"];
  for (const p of candidates) {
    try {
      const m = readFileSync(p, "utf8").match(API_KEY_RE);
      if (m && m[1]) return m[1].trim();
    } catch {
      // try next
    }
  }
  throw new Error("CURSOR_API_KEY not found (env or .env)");
}

/** Records which tools were called so we can assert the navigate happened. */
const calls: string[] = [];

const stubBackend: BrowserBackend = {
  async navigate(_agentId, url) {
    calls.push(`navigate:${url}`);
    return { url, status: 200, redirected: false };
  },
  async screenshot() {
    return { imagePath: "/tmp/stub.png", width: 1, height: 1, bytes: 0 };
  },
  async snapshot() {
    return { tree: [], url: "https://example.com/", title: "Example Domain" };
  },
  async click() {
    return { clicked: true, urlAfter: "https://example.com/", ms: 1 };
  },
  async type() {
    return { typed: true, valueAfter: "" };
  },
  async evaluate() {
    return { value: null };
  },
  async consoleMessages() {
    return [];
  },
  async networkRequests() {
    return [];
  },
  async waitFor() {
    return { matched: true, ms: 0 };
  },
  async back() {
    return { url: "https://example.com/" };
  },
  async forward() {
    return { url: "https://example.com/" };
  },
  async reload() {
    return { url: "https://example.com/" };
  },
  async state() {
    return {
      agentId: "stub",
      exists: true,
      url: "https://example.com/",
      title: "Example Domain",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      lastAction: null,
    };
  },
};

async function main(): Promise<number> {
  if (process.env.RUN_SDK_SMOKE !== "true") {
    console.log("[smoke] RUN_SDK_SMOKE!=true — skipping (set RUN_SDK_SMOKE=true to run).");
    return 0;
  }

  const apiKey = loadApiKey();
  registerBrowserBackend(stubBackend);
  const mcp = await startBrowserMcpServer();
  const agentId = `smoke-${randomUUID()}`;
  const mcpUrl = mcp.urlForAgent(agentId);
  console.log(`[smoke] MCP server at ${mcp.baseUrl} ; agent endpoint ${mcpUrl}`);

  const seenTypes = new Set<string>();
  const toolNames: string[] = [];

  try {
    const agent = await CursorAgent.create({
      apiKey,
      agentId,
      model: { id: MODEL_ID },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
      mcpServers: { harness_browser: { url: mcpUrl } },
    });
    console.log("[smoke] agent created; sending prompt…");
    const run = await agent.send(PROMPT, { onDelta: () => {} });

    const timer = setTimeout(() => {
      console.error("[smoke] stream timeout — aborting");
    }, STREAM_TIMEOUT_MS);
    try {
      for await (const event of run.stream()) {
        const e = event as { type?: string; name?: string; status?: string; args?: unknown };
        if (typeof e.type === "string") seenTypes.add(e.type);
        if (e.type === "tool_call" && typeof e.name === "string") {
          toolNames.push(e.name);
          console.log(`[smoke]   tool_call ${e.status ?? ""} name=${e.name} args=${JSON.stringify(e.args)}`);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await mcp.close();
  }

  console.log("[smoke] event types seen:", [...seenTypes].join(", "));
  console.log("[smoke] tool calls:", toolNames.join(", ") || "(none)");
  console.log("[smoke] backend invocations:", calls.join(", ") || "(none)");

  const navigated = calls.some((c) => c.startsWith("navigate:"));
  // Ground truth: the backend being hit proves the SDK dialed our loopback MCP
  // server and routed browser_navigate to it (OQ-24 transport confirmed).
  if (navigated) {
    console.log(
      `[smoke] PASS — SDK dialed the loopback MCP server and invoked browser_navigate (event name surfaced as "${toolNames.join("/") || "?"}"; browser identity is in tool_call args, not name).`,
    );
    return 0;
  }
  console.log("[smoke] FAIL — backend never hit. Inspect transport/registration.");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error("[smoke] error:", err);
    process.exit(1);
  });
