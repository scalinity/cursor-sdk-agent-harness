import { afterEach, describe, expect, it } from "vitest";
import { openTestDb } from "./helpers.js";
import { createRepositories } from "../repositories/index.js";
import type { DbClient } from "../client.js";

let client: DbClient | null = null;

afterEach(() => {
  if (client) {
    client.close();
    client = null;
  }
});

describe("SettingsRepo", () => {
  it("get/set/delete round-trip", () => {
    client = openTestDb();
    const repos = createRepositories(client.raw);

    expect(repos.settings.get<number>("pricing.promo_multiplier")).toBeCloseTo(1.0);

    repos.settings.set("custom.key", { hello: "world" }, "test");
    expect(repos.settings.get("custom.key")).toEqual({ hello: "world" });

    repos.settings.delete("custom.key");
    expect(repos.settings.get("custom.key")).toBeUndefined();

    const all = repos.settings.getAll();
    const keys = all.map((row) => row.key);
    expect(keys).toContain("defaultModelId");
  });
});

describe("McpServersRepo", () => {
  it("creates, lists, updates, and deletes mcp configs", () => {
    client = openTestDb({ skipSeed: true });
    const repos = createRepositories(client.raw);

    const created = repos.mcpServers.create({
      name: "github",
      config: { type: "stdio", command: "node", args: ["server.js"] },
    });
    expect(created.validationStatus).toBe("unknown");

    const updated = repos.mcpServers.update(created.id, {
      enabled: false,
      validationStatus: "valid",
      validationMessage: "ok",
    });
    expect(updated.enabled).toBe(false);
    expect(updated.validationStatus).toBe("valid");

    const byName = repos.mcpServers.getByName("github");
    expect(byName?.id).toBe(created.id);

    const list = repos.mcpServers.list();
    expect(list).toHaveLength(1);

    repos.mcpServers.delete(created.id);
    expect(repos.mcpServers.list()).toHaveLength(0);
  });

  it("UNIQUE(name) rejects duplicate inserts", () => {
    client = openTestDb({ skipSeed: true });
    const repos = createRepositories(client.raw);
    repos.mcpServers.create({
      name: "dup",
      config: { type: "stdio", command: "ls" },
    });
    expect(() =>
      repos.mcpServers.create({
        name: "dup",
        config: { type: "stdio", command: "ls" },
      }),
    ).toThrow(/UNIQUE/i);
  });
});

describe("SubagentDefinitionsRepo", () => {
  it("creates and updates with JSON model/mcp arrays", () => {
    client = openTestDb({ skipSeed: true });
    const repos = createRepositories(client.raw);

    const sub = repos.subagents.create({
      name: "explorer",
      description: "Explore unknown codebases",
      prompt: "Read files; summarize.",
      model: { id: "composer-2-5-fast" },
      mcpServerIds: ["a", "b"],
    });
    expect(sub.enabled).toBe(true);
    expect(sub.mcpServerIds).toEqual(["a", "b"]);

    const next = repos.subagents.update(sub.id, {
      enabled: false,
      mcpServerIds: [],
    });
    expect(next.enabled).toBe(false);
    expect(next.mcpServerIds).toEqual([]);
  });
});
