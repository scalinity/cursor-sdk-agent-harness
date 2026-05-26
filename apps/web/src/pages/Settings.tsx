import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ExecutionMode } from "@harness/shared";
import { useAgentStore } from "../state/agent-store.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "../hooks/useCsrfToken.js";
import { mutatingRequest } from "../lib/http-client.js";
import { ModeToggle } from "../components/ModeToggle.js";
import { DocsSettings } from "../components/settings/DocsSettings.js";
import { CommandsSettings } from "../components/settings/CommandsSettings.js";
import { ProvidersSettings } from "../components/settings/ProvidersSettings.js";
import { IndexSettings } from "../components/settings/IndexSettings.js";
import { useTheme } from "../hooks/useTheme.js";
import { THEME_OPTIONS } from "../lib/theme-options.js";

function ThemeSettingsSection() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <section className="settings-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="settings-section__title">Theme</h2>
          <p className="settings-section__desc">Current palette: {resolvedTheme}</p>
        </div>
        <div
          className="inline-flex h-control-lg overflow-hidden rounded-md border border-border-subtle bg-surface-1"
          role="radiogroup"
          aria-label="Theme"
        >
          {THEME_OPTIONS.map((option) => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => void setTheme(option.value)}
                role="radio"
                aria-checked={active}
                className={active
                  ? "border-r border-border-subtle bg-accent-primary px-3 text-md font-medium text-text-inverse last:border-r-0"
                  : "border-r border-border-subtle px-3 text-md font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary last:border-r-0"}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 overflow-hidden rounded-md border border-border-subtle">
        <div className="h-8 bg-background" title="Background" />
        <div className="h-8 bg-surface-1" title="Surface 1" />
        <div className="h-8 bg-accent-primary" title="Accent" />
        <div className="h-8 bg-text-primary" title="Text" />
      </div>
    </section>
  );
}

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

        <ThemeSettingsSection />

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
            <button
              type="button"
              onClick={() => navigate("/notepads")}
              className="settings-link"
            >
              Notepads →
            </button>
          </div>
        </section>

        <IndexSettings />
        <ProvidersSettings />
        <DocsSettings />
        <CommandsSettings />
      </div>
    </div>
  );
}
