import { useState } from "react";
import { Button } from "../primitives/Button.js";
import { useWorkspacePicker, type WorkspacePickError } from "../../hooks/useWorkspacePicker.js";
import { isDesktop } from "../../lib/desktop-bridge.js";

function errorCopy(err: WorkspacePickError): string {
  switch (err.code) {
    case "cancelled":
      return "Workspace selection cancelled. Pick a folder to continue.";
    case "missing":
      return `That folder doesn't exist: ${err.path}`;
    case "symlink_escape":
      return `That folder symlinks outside its parent: ${err.path}`;
    case "unknown":
      return err.message;
  }
}

/**
 * Blocks the shell while `activeWorkspaceId` is null. Single primary action
 * opens the native folder picker (or window.prompt in browser mode); on
 * success the parent re-renders without us because the active-workspace hook
 * surfaces the new id.
 *
 * Empty-state copy is intentionally minimal — `--color-text-tertiary` mono
 * text matches the harness density elsewhere.
 */
export function WorkspaceRequiredModal() {
  const { pick, busy } = useWorkspacePicker();
  const [error, setError] = useState<WorkspacePickError | null>(null);

  const onPick = async () => {
    setError(null);
    const result = await pick();
    if (!result.ok) setError(result.error);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-surface-0/80 backdrop-blur-sm">
      <div className="max-w-lg rounded-lg border border-border-subtle bg-surface-1 p-6 shadow-lg">
        <h2 className="m-0 mb-2 text-base font-semibold text-text-primary">
          Pick a workspace to get started.
        </h2>
        <p className="m-0 mb-4 text-md text-text-tertiary">
          {isDesktop
            ? "Choose a folder on disk. The harness will sandbox agents to this path and its children."
            : "Enter an absolute path. The harness will sandbox agents to this path and its children."}
        </p>
        {error ? (
          <p className="mono mb-4 text-sm text-warning">{errorCopy(error)}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={() => void onPick()}
            disabled={busy}
          >
            {busy ? "Picking…" : isDesktop ? "Pick folder" : "Enter path"}
          </Button>
        </div>
      </div>
    </div>
  );
}
