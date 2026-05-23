import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { WorkspacePolicy } from "../workspace-policy.js";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

interface Harness {
  raw: BetterSqlite3Database;
  policy: WorkspacePolicy;
  allowlist: ReturnType<typeof createRepositories>["workspaceAllowlist"];
  tmpRoot: string;
}

async function makeHarness(): Promise<Harness> {
  const client = openTestDb({ skipSeed: true });
  const repos = createRepositories(client.raw);
  const tmpRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "harness-wp-")),
  );
  return {
    raw: client.raw,
    policy: new WorkspacePolicy({ allowlist: repos.workspaceAllowlist }),
    allowlist: repos.workspaceAllowlist,
    tmpRoot,
  };
}

describe("WorkspacePolicy.check", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await makeHarness();
  });

  afterEach(async () => {
    h.raw.close();
    await fs.rm(h.tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("returns missing for a nonexistent path", async () => {
    const decision = await h.policy.check(path.join(h.tmpRoot, "does-not-exist"));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("missing");
  });

  it("returns not_allowlisted for a real path with no matching entry", async () => {
    const dir = path.join(h.tmpRoot, "no-allow");
    await fs.mkdir(dir);
    const decision = await h.policy.check(dir);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("not_allowlisted");
  });

  it("allows an exact allowlist match", async () => {
    const dir = path.join(h.tmpRoot, "exact");
    await fs.mkdir(dir);
    const entry = h.allowlist.create({ path: dir, recursive: false });
    const decision = await h.policy.check(dir);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.matchedEntryId).toBe(entry.id);
  });

  it("allows a descendant when allowlist row is recursive", async () => {
    const dir = path.join(h.tmpRoot, "proj");
    const child = path.join(dir, "sub", "deep");
    await fs.mkdir(child, { recursive: true });
    const entry = h.allowlist.create({ path: dir, recursive: true });
    const decision = await h.policy.check(child);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.matchedEntryId).toBe(entry.id);
  });

  it("rejects a descendant when allowlist row is non-recursive", async () => {
    const dir = path.join(h.tmpRoot, "single");
    const child = path.join(dir, "leaf");
    await fs.mkdir(child, { recursive: true });
    h.allowlist.create({ path: dir, recursive: false });
    const decision = await h.policy.check(child);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("not_allowlisted");
  });

  it("rejects a symlink that escapes its apparent parent", async () => {
    // Create a forbidden target outside our allowlist.
    const forbidden = path.join(h.tmpRoot, "forbidden");
    await fs.mkdir(forbidden);
    // Create an apparent parent that is allowlisted recursively.
    const allowedRoot = path.join(h.tmpRoot, "allowed");
    await fs.mkdir(allowedRoot);
    h.allowlist.create({ path: allowedRoot, recursive: true });

    // Place a symlink INSIDE the allowed parent that points to the forbidden
    // location. Its realpath escapes the allowed parent.
    const symlinkInsideAllowed = path.join(allowedRoot, "escape");
    await fs.symlink(forbidden, symlinkInsideAllowed);

    const decision = await h.policy.check(symlinkInsideAllowed);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("symlink_escape");
  });

  it("allows a symlink that stays within its apparent parent", async () => {
    // Create allowed parent.
    const parent = path.join(h.tmpRoot, "parent");
    await fs.mkdir(parent);
    h.allowlist.create({ path: parent, recursive: true });

    // Create a real subdir and a symlink to it, both inside the same parent.
    const real = path.join(parent, "real");
    await fs.mkdir(real);
    const link = path.join(parent, "link");
    await fs.symlink(real, link);

    const decision = await h.policy.check(link);
    expect(decision.allowed).toBe(true);
  });

  it("normalizes paths before comparison", async () => {
    const dir = path.join(h.tmpRoot, "norm");
    await fs.mkdir(dir);
    h.allowlist.create({ path: dir, recursive: true });
    const messy = path.join(dir, "sub", "..", "sub2");
    await fs.mkdir(path.join(dir, "sub2"));
    const decision = await h.policy.check(messy);
    expect(decision.allowed).toBe(true);
  });
});
