import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories } from "../../db/repositories/index.js";
import { registerRulesRoutes } from "../rules.routes.js";

async function createWorkspaceWithRules(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-rules-test-"));
  await fs.mkdir(path.join(dir, ".harness", "rules"), { recursive: true });

  await fs.writeFile(
    path.join(dir, ".harness", "rules", "testing.md"),
    `---
name: testing-conventions
scope: always
description: Testing patterns
---

- Use vitest for tests
- Place tests next to source
`,
  );

  await fs.writeFile(
    path.join(dir, ".harness", "rules", "api-patterns.md"),
    `---
name: api-patterns
scope: glob
glob: "src/routes/**/*.ts"
description: REST API patterns
---

- Use Zod validation
- Return 400 for validation failures
`,
  );

  await fs.writeFile(
    path.join(dir, ".harness", "rules", "deploy.md"),
    `---
name: deployment-checklist
scope: manual
description: Pre-deployment checklist
---

- Verify migrations
- Check env vars
`,
  );

  return dir;
}

function setup(workspacePath: string | null) {
  const db = openTestDb({ skipSeed: true });
  const repos = createRepositories(db.raw);
  if (workspacePath) {
    repos.workspaceAllowlist.create({ path: workspacePath });
    repos.settings.set("app.activeWorkspaceId", workspacePath);
  }
  const app = Fastify({ logger: false });
  return { db, repos, app };
}

describe("/api/rules", () => {
  let tmpDir: string;
  let cleanup: Array<() => Promise<void> | void> = [];

  beforeEach(async () => {
    tmpDir = await createWorkspaceWithRules();
    cleanup = [];
  });
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists rules sorted by scope (always, glob, manual)", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerRulesRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({ method: "GET", url: "/api/rules" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string; scope: string }>;
    expect(body).toHaveLength(3);
    expect(body[0]!.scope).toBe("always");
    expect(body[0]!.name).toBe("testing-conventions");
    expect(body[1]!.scope).toBe("glob");
    expect(body[2]!.scope).toBe("manual");
  });

  it("returns empty array when no workspace is active", async () => {
    const { db, repos, app } = setup(null);
    cleanup.push(() => app.close(), () => db.close());
    await registerRulesRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({ method: "GET", url: "/api/rules" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns empty array when .harness/rules doesn't exist", async () => {
    const noRulesDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-no-rules-"));
    const { db, repos, app } = setup(noRulesDir);
    cleanup.push(
      () => app.close(),
      () => db.close(),
      () => fs.rm(noRulesDir, { recursive: true, force: true }),
    );
    await registerRulesRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({ method: "GET", url: "/api/rules" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("gets a specific rule by name", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerRulesRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({ method: "GET", url: "/api/rules/testing-conventions" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("testing-conventions");
    expect(body.content).toContain("Use vitest");
  });

  it("returns 404 for unknown rule name", async () => {
    const { db, repos, app } = setup(tmpDir);
    cleanup.push(() => app.close(), () => db.close());
    await registerRulesRoutes(app, {
      settingsRepo: repos.settings,
      allowlistRepo: repos.workspaceAllowlist,
    });

    const res = await app.inject({ method: "GET", url: "/api/rules/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});
