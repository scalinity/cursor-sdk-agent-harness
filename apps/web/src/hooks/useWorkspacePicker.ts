/**
 * useWorkspacePicker — composes the native folder picker (when available)
 * with the workspace allowlist add + active-set endpoints into a single
 * "pick a workspace" affordance.
 *
 * Flow:
 *   1. Ask the desktop bridge for a folder path (or fall back to window.prompt
 *      in browser mode — minimal but functional).
 *   2. Validate the path through the existing workspace-allowlist policy
 *      endpoint so realpath + symlink-escape checks fire before persistence.
 *   3. If the path isn't already allowlisted, add it.
 *   4. Promote the entry to `activeWorkspaceId`.
 */
import { useCallback, useState } from "react";
import { desktopBridge } from "../lib/desktop-bridge.js";
import { useActiveWorkspace } from "./useActiveWorkspace.js";
import { useWorkspaceAllowlist } from "./useWorkspaceAllowlist.js";

export type WorkspacePickError =
  | { code: "cancelled" }
  | { code: "missing"; path: string }
  | { code: "symlink_escape"; path: string }
  | { code: "unknown"; message: string };

export interface UseWorkspacePickerResult {
  pick: () => Promise<{ ok: true } | { ok: false; error: WorkspacePickError }>;
  busy: boolean;
}

export function useWorkspacePicker(): UseWorkspacePickerResult {
  const { entries, reload: reloadAllowlist, add, validateMany } = useWorkspaceAllowlist();
  const { setActive, reload: reloadActive } = useActiveWorkspace();
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async (): Promise<
    { ok: true } | { ok: false; error: WorkspacePickError }
  > => {
    setBusy(true);
    try {
      let candidate: string | null = null;
      if (desktopBridge) {
        const result = await desktopBridge.openWorkspaceFolderDialog();
        if ("cancelled" in result) {
          return { ok: false, error: { code: "cancelled" } };
        }
        candidate = result.path;
      } else {
        // Browser-mode fallback. The phase prompt calls for a separate modal;
        // window.prompt keeps the renderer functional during pnpm dev without
        // a heavier UI surface. The desktop bridge is the supported path.
        const entered = window.prompt(
          "Enter an absolute path to a workspace folder.",
        );
        if (!entered) {
          return { ok: false, error: { code: "cancelled" } };
        }
        candidate = entered;
      }

      const decisions = await validateMany([candidate]);
      const decision = decisions.get(candidate);
      if (!decision) {
        return {
          ok: false,
          error: { code: "unknown", message: "validation returned no result" },
        };
      }
      if (decision.allowed === false && decision.reason === "missing") {
        return { ok: false, error: { code: "missing", path: candidate } };
      }
      if (decision.allowed === false && decision.reason === "symlink_escape") {
        return {
          ok: false,
          error: { code: "symlink_escape", path: candidate },
        };
      }

      const normalizedPath = decision.normalizedPath;
      const existing = entries.find((e) => e.path === normalizedPath);
      let entryId: string;
      if (existing) {
        entryId = existing.id;
      } else {
        const created = await add({ path: candidate, recursive: true });
        entryId = created.id;
      }

      await setActive(entryId);
      // Refresh views that depend on the allowlist + active workspace.
      await reloadAllowlist();
      await reloadActive();
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: "unknown",
          message: e instanceof Error ? e.message : "workspace pick failed",
        },
      };
    } finally {
      setBusy(false);
    }
  }, [entries, add, validateMany, setActive, reloadAllowlist, reloadActive]);

  return { pick, busy };
}
