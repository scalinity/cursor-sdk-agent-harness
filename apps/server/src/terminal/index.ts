// Embedded-terminal layer barrel.
//
// `terminal-session` owns the single long-lived PTY + ring buffer;
// `terminal-ws` is the `/ws/terminal` Fastify route. Terminal I/O is
// ephemeral and never enters the events table or the run bus.

import os from "node:os";
import type { SettingsRepo } from "../db/repositories/settings.repo.js";
import type { WorkspaceAllowlistRepo } from "../db/repositories/workspace-allowlist.repo.js";
import { ACTIVE_WORKSPACE_SETTING_KEY } from "../config/settings-keys.js";

export { TerminalSession } from "./terminal-session.js";
export type {
  CreateTerminalSessionOptions,
  PtyProcess,
  SpawnPty,
  SpawnPtyOptions,
  TerminalClient,
} from "./terminal-session.js";
export { terminalWsPlugin, type TerminalWsPluginOptions } from "./terminal-ws.js";

/**
 * Build the resolver the terminal session uses to pick its start directory:
 * the active workspace's path (allowlist-resolved), else the user's home dir.
 * The allowlist path was realpath-validated when it was added, and a real
 * shell can `cd` anywhere afterward, so this gates the *start* directory only
 * — consistent with how run cwd is chosen.
 */
export function createWorkspaceCwdResolver(deps: {
  settings: SettingsRepo;
  allowlist: WorkspaceAllowlistRepo;
}): () => string {
  return () => {
    const raw = deps.settings.get<string | null>(ACTIVE_WORKSPACE_SETTING_KEY);
    const id = typeof raw === "string" && raw.length > 0 ? raw : null;
    if (id) {
      const row = deps.allowlist.getById(id);
      if (row) return row.path;
    }
    return os.homedir();
  };
}
