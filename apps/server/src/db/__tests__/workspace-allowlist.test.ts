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

describe("WorkspaceAllowlistRepo", () => {
  it("findMatching returns the exact path entry regardless of recursive flag", () => {
    client = openTestDb({ skipSeed: true });
    const repos = createRepositories(client.raw);

    const entry = repos.workspaceAllowlist.create({
      path: "/Users/danny/code/projA",
      label: "Project A",
      recursive: false,
    });

    const match = repos.workspaceAllowlist.findMatching("/Users/danny/code/projA");
    expect(match?.id).toBe(entry.id);

    const descendant = repos.workspaceAllowlist.findMatching(
      "/Users/danny/code/projA/src",
    );
    expect(descendant).toBeNull();
  });

  it("findMatching returns a recursive ancestor for descendant paths", () => {
    client = openTestDb({ skipSeed: true });
    const repos = createRepositories(client.raw);

    const entry = repos.workspaceAllowlist.create({
      path: "/Users/danny/code",
      recursive: true,
    });

    const match = repos.workspaceAllowlist.findMatching(
      "/Users/danny/code/projA/src/index.ts",
    );
    expect(match?.id).toBe(entry.id);
  });

  it("findMatching returns null when no entry covers the path", () => {
    client = openTestDb({ skipSeed: true });
    const repos = createRepositories(client.raw);
    repos.workspaceAllowlist.create({
      path: "/Users/danny/code",
      recursive: false,
    });
    expect(
      repos.workspaceAllowlist.findMatching("/Users/danny/other"),
    ).toBeNull();
  });

  it("UNIQUE(path) rejects duplicate inserts", () => {
    client = openTestDb({ skipSeed: true });
    const repos = createRepositories(client.raw);
    repos.workspaceAllowlist.create({ path: "/Users/danny/code", recursive: true });
    expect(() =>
      repos.workspaceAllowlist.create({ path: "/Users/danny/code" }),
    ).toThrow(/UNIQUE/i);
  });
});
