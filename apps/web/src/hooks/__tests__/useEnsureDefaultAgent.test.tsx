import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, CreateAgentRequest } from "@harness/shared";
import {
  useEnsureDefaultAgent,
  type UseEnsureDefaultAgentInput,
} from "../useEnsureDefaultAgent.js";

// fetchUniversalIds hits /api/mcp-servers + /api/subagents; both expect { items }.
vi.mock("../../lib/http-client.js", () => ({
  httpRequest: vi.fn(async () => ({ items: [] })),
}));

const MODEL = "composer-2-5-fast";
const MAP_KEY = "harness:defaultAgentIds";

function agent(
  id: string,
  modelId: string = MODEL,
  status: AgentSummary["status"] = "active",
): AgentSummary {
  return { id, name: id, modelId, status } as AgentSummary;
}

describe("useEnsureDefaultAgent", () => {
  let createAgent: ReturnType<typeof vi.fn>;
  let selectAgent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // This jsdom config ships without a functional localStorage; the hook
    // tolerates that (try/catch → empty map), but the managed-defaults logic
    // under test depends on it, so install an in-memory implementation.
    const store = new Map<string, string>();
    const mem = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => {
        store.delete(k);
      },
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
    } as Storage;
    Object.defineProperty(window, "localStorage", {
      value: mem,
      configurable: true,
      writable: true,
    });
    createAgent = vi.fn(async (req: CreateAgentRequest) =>
      agent(`agent-${req.cwd?.[0] ?? "?"}`, req.modelId),
    );
    selectAgent = vi.fn();
  });
  afterEach(() => vi.clearAllMocks());

  function input(overrides: Partial<UseEnsureDefaultAgentInput> = {}): UseEnsureDefaultAgentInput {
    return {
      activeWorkspaceId: "ws-home",
      workspacePath: "/Users/danny",
      modelId: MODEL,
      agents: [],
      activeAgent: null,
      agentsLoaded: true,
      createAgent,
      selectAgent,
      ...overrides,
    };
  }

  it("waits for the initial agent list before provisioning", async () => {
    renderHook((p: UseEnsureDefaultAgentInput) => useEnsureDefaultAgent(p), {
      initialProps: input({ agentsLoaded: false }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("cold start: creates and selects a default agent for the active workspace", async () => {
    renderHook((p: UseEnsureDefaultAgentInput) => useEnsureDefaultAgent(p), {
      initialProps: input(),
    });
    await waitFor(() => expect(createAgent).toHaveBeenCalledTimes(1));
    expect(createAgent.mock.calls[0]?.[0].cwd).toEqual(["/Users/danny"]);
  });

  it("re-provisions when the remembered default is not active", async () => {
    window.localStorage.setItem(MAP_KEY, JSON.stringify({ [`ws-home::${MODEL}`]: "agent-error" }));
    const errored = agent("agent-error", MODEL, "error");
    renderHook((p: UseEnsureDefaultAgentInput) => useEnsureDefaultAgent(p), {
      initialProps: input({ activeAgent: errored, agents: [errored] }),
    });

    await waitFor(() => expect(createAgent).toHaveBeenCalledTimes(1));
    expect(createAgent.mock.calls[0]?.[0].cwd).toEqual(["/Users/danny"]);
  });

  it("re-provisions the default agent when the active workspace changes", async () => {
    window.localStorage.setItem(MAP_KEY, JSON.stringify({ [`ws-home::${MODEL}`]: "agent-home" }));
    const home = agent("agent-home");
    const { rerender } = renderHook(
      (p: UseEnsureDefaultAgentInput) => useEnsureDefaultAgent(p),
      { initialProps: input({ activeAgent: home, agents: [home] }) },
    );
    // Invariant holds for the home workspace — no provisioning.
    expect(createAgent).not.toHaveBeenCalled();

    // Switch workspace while the stale home default is still the active agent.
    rerender(
      input({
        activeWorkspaceId: "ws-alpha",
        workspacePath: "/p/alpha",
        activeAgent: home,
        agents: [home],
      }),
    );
    await waitFor(() => expect(createAgent).toHaveBeenCalledTimes(1));
    expect(createAgent.mock.calls[0]?.[0].cwd).toEqual(["/p/alpha"]);
    await waitFor(() => expect(selectAgent).toHaveBeenCalledWith("agent-/p/alpha"));
  });

  it("does not replace an explicitly-chosen custom agent when the workspace changes", async () => {
    // A managed home default exists, but the active agent is a custom one.
    window.localStorage.setItem(MAP_KEY, JSON.stringify({ [`ws-home::${MODEL}`]: "agent-home" }));
    const custom = agent("agent-custom");
    const { rerender } = renderHook(
      (p: UseEnsureDefaultAgentInput) => useEnsureDefaultAgent(p),
      { initialProps: input({ activeAgent: custom, agents: [custom] }) },
    );
    rerender(
      input({
        activeWorkspaceId: "ws-alpha",
        workspacePath: "/p/alpha",
        activeAgent: custom,
        agents: [custom],
      }),
    );
    // Yield a tick for any async provisioning path; the custom agent must stand.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createAgent).not.toHaveBeenCalled();
  });
});
