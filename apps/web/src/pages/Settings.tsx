import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ExecutionMode } from "@harness/shared";
import { useAgentStore } from "../state/agent-store.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "../hooks/useCsrfToken.js";
import { mutatingRequest } from "../lib/http-client.js";
import { ModeToggle } from "../components/ModeToggle.js";

export function Settings() {
  const navigate = useNavigate();
  const csrf = useCsrfToken();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const activeAgent = useAgentStore((s) => activeAgentId ? (s.byId[activeAgentId] ?? null) : null);
  const executionMode: ExecutionMode = activeAgent?.executionMode ?? "agent";

  const onModeChange = useCallback(
    (mode: ExecutionMode) => {
      if (!activeAgent) return;
      useAgentStore.getState().upsertAgent({ ...activeAgent, executionMode: mode });
      void mutatingRequest(`/api/agents/${activeAgent.id}`, {
        method: "PATCH",
        body: { executionMode: mode },
        getCsrfToken: () => useUiStore.getState().csrfToken,
        refreshCsrfToken: () => csrf.refresh(),
      });
    },
    [activeAgent, csrf],
  );

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="settings-page__back"
        >
          ← Back
        </button>
        <h1 className="settings-page__title">Settings</h1>
      </div>

      <div className="settings-page__content">
        <section className="settings-section">
          <h2 className="settings-section__title">Execution Mode</h2>
          <p className="settings-section__desc">
            Controls how the agent handles tool use and file modifications.
          </p>
          <div className="settings-section__control">
            <ModeToggle value={executionMode} onChange={onModeChange} />
          </div>
          <dl className="settings-mode-descriptions">
            <div className="settings-mode-descriptions__item">
              <dt>Ask</dt>
              <dd>Read-only. The agent answers questions but makes no file changes or tool calls.</dd>
            </div>
            <div className="settings-mode-descriptions__item">
              <dt>Agent</dt>
              <dd>Default. The agent can read and write files, run commands, and use tools with approval prompts.</dd>
            </div>
            <div className="settings-mode-descriptions__item">
              <dt>YOLO</dt>
              <dd>Auto-approve all tool use. No confirmation prompts. Use with caution.</dd>
            </div>
          </dl>
        </section>

        <section className="settings-section">
          <h2 className="settings-section__title">Integrations</h2>
          <div className="settings-section__links">
            <button
              type="button"
              onClick={() => navigate("/settings/mcp-servers")}
              className="settings-link"
            >
              MCP Servers →
            </button>
            <button
              type="button"
              onClick={() => navigate("/settings/subagents")}
              className="settings-link"
            >
              Subagents →
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
