import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentRow, McpServerRow, SubagentDefinitionRow } from "@harness/shared";
import { WorkspacePolicy } from "../../security/workspace-policy.js";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { WorkspaceAllowlistRepo } from "../../db/repositories/workspace-allowlist.repo.js";
import {
  buildAgentOptions,
  WorkspaceRejectedError,
} from "../agent-options-builder.js";

function agentRow(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    name: "test-agent",
    status: "creating",
    mode: "local",
    modelId: "composer-2-5-fast",
    cwd: null,
    settingSources: null,
    sandboxEnabled: null,
    cloudOptions: null,
    mcpServerIds: [],
    subagentDefinitionIds: [],
    sdkListSeenAt: null,
    lastActiveAt: null,
    error: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    terminatedAt: null,
    ...over,
  };
}

describe("buildAgentOptions", () => {
  let tmpDir: string;
  let allowedDir: string;
  let allowlist: WorkspaceAllowlistRepo;
  let policy: WorkspacePolicy;
  let db: ReturnType<typeof openTestDb>;

  beforeEach(async () => {
    db = openTestDb();
    allowlist = new WorkspaceAllowlistRepo(db.raw);
    policy = new WorkspacePolicy({ allowlist });
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-aob-"));
    allowedDir = path.join(tmpDir, "allowed");
    await fs.mkdir(allowedDir, { recursive: true });
    const realAllowed = await fs.realpath(allowedDir);
    allowlist.create({ path: realAllowed, recursive: true });
  });

  afterEach(async () => {
    db.raw.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("builds local options with single cwd resolved to a string", async () => {
    const opts = await buildAgentOptions({
      agent: agentRow({ cwd: [allowedDir], settingSources: ["project"], sandboxEnabled: true }),
      apiKey: "sk-test-12345678",
      mcpServers: [],
      subagents: [],
      workspacePolicy: policy,
    });
    expect(opts.apiKey).toBe("sk-test-12345678");
    expect(opts.agentId).toBe("agent-1");
    expect(opts.model).toEqual({ id: "composer-2-5-fast" });
    expect(opts.local).toBeDefined();
    expect(opts.local?.cwd).toBe(allowedDir);
    expect(opts.local?.settingSources).toEqual(["project"]);
    expect(opts.local?.sandboxOptions).toEqual({ enabled: true });
    expect(opts.cloud).toBeUndefined();
  });

  it("builds local options with multiple cwds as a string[]", async () => {
    const second = path.join(tmpDir, "allowed-2");
    await fs.mkdir(second);
    const realSecond = await fs.realpath(second);
    allowlist.create({ path: realSecond, recursive: true });
    const opts = await buildAgentOptions({
      agent: agentRow({ cwd: [allowedDir, second] }),
      apiKey: "sk-test-12345678",
      mcpServers: [],
      subagents: [],
      workspacePolicy: policy,
    });
    expect(Array.isArray(opts.local?.cwd)).toBe(true);
    expect(opts.local?.cwd).toEqual([allowedDir, second]);
  });

  it("rejects when any cwd is not allowlisted with WORKSPACE_REJECTED", async () => {
    const outsideDir = path.join(tmpDir, "outside");
    await fs.mkdir(outsideDir);
    await expect(
      buildAgentOptions({
        agent: agentRow({ cwd: [allowedDir, outsideDir] }),
        apiKey: "sk-test-12345678",
        mcpServers: [],
        subagents: [],
        workspacePolicy: policy,
      }),
    ).rejects.toBeInstanceOf(WorkspaceRejectedError);
  });

  it("rejects when local mode has no cwd entries", async () => {
    await expect(
      buildAgentOptions({
        agent: agentRow({ cwd: [] }),
        apiKey: "sk-test-12345678",
        mcpServers: [],
        subagents: [],
        workspacePolicy: policy,
      }),
    ).rejects.toBeInstanceOf(WorkspaceRejectedError);
  });

  it("only includes MCP servers that are enabled AND validation=valid", async () => {
    const servers: McpServerRow[] = [
      mcpRow({ id: "m1", name: "good", enabled: true, validationStatus: "valid" }),
      mcpRow({ id: "m2", name: "disabled", enabled: false, validationStatus: "valid" }),
      mcpRow({ id: "m3", name: "unvalidated", enabled: true, validationStatus: "unknown" }),
      mcpRow({ id: "m4", name: "bad", enabled: true, validationStatus: "invalid" }),
    ];
    const opts = await buildAgentOptions({
      agent: agentRow({ cwd: [allowedDir] }),
      apiKey: "sk-test-12345678",
      mcpServers: servers,
      subagents: [],
      workspacePolicy: policy,
    });
    expect(Object.keys(opts.mcpServers ?? {})).toEqual(["good"]);
  });

  it("includes enabled subagents with their referenced MCP server names", async () => {
    const servers: McpServerRow[] = [
      mcpRow({ id: "m-keep", name: "keep", enabled: true, validationStatus: "valid" }),
      mcpRow({ id: "m-drop", name: "drop", enabled: true, validationStatus: "invalid" }),
    ];
    const subs: SubagentDefinitionRow[] = [
      subRow({
        id: "s1",
        name: "explorer",
        enabled: true,
        description: "explore",
        prompt: "do it",
        mcpServerIds: ["m-keep", "m-drop"],
      }),
      subRow({
        id: "s2",
        name: "disabled",
        enabled: false,
        description: "no",
        prompt: "no",
      }),
    ];
    const opts = await buildAgentOptions({
      agent: agentRow({ cwd: [allowedDir] }),
      apiKey: "sk-test-12345678",
      mcpServers: servers,
      subagents: subs,
      workspacePolicy: policy,
    });
    expect(Object.keys(opts.agents ?? {})).toEqual(["explorer"]);
    expect(opts.agents?.explorer?.mcpServers).toEqual(["m-keep"]);
  });

  it("omits subagent.model when model is null (inherit)", async () => {
    const subs: SubagentDefinitionRow[] = [
      subRow({
        id: "s1",
        name: "inheritor",
        enabled: true,
        description: "inherits",
        prompt: "p",
        model: null,
      }),
    ];
    const opts = await buildAgentOptions({
      agent: agentRow({ cwd: [allowedDir] }),
      apiKey: "sk-test-12345678",
      mcpServers: [],
      subagents: subs,
      workspacePolicy: policy,
    });
    expect(opts.agents?.inheritor).toBeDefined();
    expect(opts.agents?.inheritor?.model).toBeUndefined();
  });

  it("forwards subagent.model when explicit override is set", async () => {
    const subs: SubagentDefinitionRow[] = [
      subRow({
        id: "s1",
        name: "explicit",
        enabled: true,
        description: "explicit",
        prompt: "p",
        model: { id: "composer-2-5" },
      }),
    ];
    const opts = await buildAgentOptions({
      agent: agentRow({ cwd: [allowedDir] }),
      apiKey: "sk-test-12345678",
      mcpServers: [],
      subagents: subs,
      workspacePolicy: policy,
    });
    expect(opts.agents?.explicit?.model).toEqual({ id: "composer-2-5" });
  });

  it("builds cloud options when mode=cloud and skips workspace validation", async () => {
    const opts = await buildAgentOptions({
      agent: agentRow({
        mode: "cloud",
        cwd: null,
        cloudOptions: {
          env: { type: "cloud", name: "default" },
          repos: [{ url: "https://example.com/repo.git" }],
        },
      }),
      apiKey: "sk-test-12345678",
      mcpServers: [],
      subagents: [],
      workspacePolicy: policy,
    });
    expect(opts.local).toBeUndefined();
    expect(opts.cloud).toEqual({
      env: { type: "cloud", name: "default" },
      repos: [{ url: "https://example.com/repo.git" }],
    });
  });
});

function mcpRow(over: Partial<McpServerRow>): McpServerRow {
  return {
    id: over.id ?? "m-x",
    name: over.name ?? "x",
    enabled: over.enabled ?? true,
    config: { command: "echo" },
    validationStatus: over.validationStatus ?? "valid",
    validationMessage: null,
    lastStatus: null,
    lastCheckedAt: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
  };
}

function subRow(over: Partial<SubagentDefinitionRow>): SubagentDefinitionRow {
  return {
    id: over.id ?? "s-x",
    name: over.name ?? "x",
    enabled: over.enabled ?? true,
    description: over.description ?? "x",
    prompt: over.prompt ?? "x",
    model: over.model === undefined ? { id: "composer-2-5-fast" } : over.model,
    mcpServerIds: over.mcpServerIds ?? [],
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
  };
}
