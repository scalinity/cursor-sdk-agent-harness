import { promises as fs } from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "../../db/__tests__/helpers.js";
import { createRepositories, type Repositories } from "../../db/repositories/index.js";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "../../config/settings-keys.js";
import { ensureDefaultWorkspace } from "../default-workspace.js";

describe("ensureDefaultWorkspace", () => {
  let db: ReturnType<typeof openTestDb>;
  let repos: Repositories;

  beforeEach(() => {
    db = openTestDb();
    repos = createRepositories(db.raw);
  });

  afterEach(() => {
    db.raw.close();
  });

  it("seeds the home directory as the active workspace when none is set", async () => {
    expect(repos.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY)).toBeFalsy();

    await ensureDefaultWorkspace({ allowlist: repos.workspaceAllowlist, settings: repos.settings });

    const activeId = repos.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);
    expect(typeof activeId).toBe("string");
    const entry = repos.workspaceAllowlist.getById(activeId as string);
    expect(entry).not.toBeNull();
    expect(entry?.path).toBe(await fs.realpath(os.homedir()));
    expect(entry?.label).toBe("Home");
    expect(entry?.recursive).toBe(true);
  });

  it("is idempotent — a second call reuses the same Home row", async () => {
    await ensureDefaultWorkspace({ allowlist: repos.workspaceAllowlist, settings: repos.settings });
    const firstId = repos.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);

    await ensureDefaultWorkspace({ allowlist: repos.workspaceAllowlist, settings: repos.settings });
    const secondId = repos.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);

    expect(secondId).toBe(firstId);
    expect(repos.workspaceAllowlist.list()).toHaveLength(1);
  });

  it("respects an existing valid active workspace and does not overwrite it", async () => {
    const tmp = await fs.realpath(await fs.mkdtemp(`${os.tmpdir()}/harness-dw-`));
    const picked = repos.workspaceAllowlist.create({ path: tmp, label: "Picked", recursive: true });
    repos.settings.set(ACTIVE_WORKSPACE_SETTING_KEY, picked.id);

    await ensureDefaultWorkspace({ allowlist: repos.workspaceAllowlist, settings: repos.settings });

    expect(repos.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY)).toBe(picked.id);
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  it("re-seeds Home when the active pointer dangles at a deleted row", async () => {
    repos.settings.set(ACTIVE_WORKSPACE_SETTING_KEY, "does-not-exist");

    await ensureDefaultWorkspace({ allowlist: repos.workspaceAllowlist, settings: repos.settings });

    const activeId = repos.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);
    expect(activeId).not.toBe("does-not-exist");
    expect(repos.workspaceAllowlist.getById(activeId as string)?.label).toBe("Home");
  });
});
