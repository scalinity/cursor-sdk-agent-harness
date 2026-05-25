import { useCallback, useState } from "react";
import type { AddableProviderKind, ModelProviderSummary } from "@harness/shared";
import { useProviders } from "../../hooks/useProviders.js";
import { Select } from "../ui/Select.js";

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "google", label: "Google (Gemini)" },
  { value: "ollama", label: "Ollama (local)" },
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  ollama: "Ollama",
  cursor: "Cursor",
};

export function ProvidersSettings() {
  const { providers, addProvider, deleteProvider, testProvider } = useProviders();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<AddableProviderKind>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const reset = useCallback(() => {
    setName("");
    setProvider("anthropic");
    setApiKey("");
    setBaseUrl("");
    setShowForm(false);
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;
      setSubmitting(true);
      setFormError(null);
      try {
        await addProvider({
          name: name.trim(),
          provider,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        });
        reset();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Failed to add provider");
      } finally {
        setSubmitting(false);
      }
    },
    [name, provider, apiKey, baseUrl, addProvider, reset],
  );

  const handleTest = useCallback(
    async (p: ModelProviderSummary) => {
      setTestResult((prev) => ({ ...prev, [p.id]: "Testing…" }));
      try {
        const res = await testProvider(p.id);
        setTestResult((prev) => ({
          ...prev,
          [p.id]: res.ok ? `OK · ${res.models.length} models` : `Failed: ${res.error ?? "unknown"}`,
        }));
      } catch (err) {
        setTestResult((prev) => ({
          ...prev,
          [p.id]: err instanceof Error ? err.message : "Test failed",
        }));
      }
    },
    [testProvider],
  );

  const handleDelete = useCallback(
    (p: ModelProviderSummary) => {
      if (confirm(`Delete provider "${p.name}"? This removes its API key from the Keychain.`)) {
        void deleteProvider(p.id);
      }
    },
    [deleteProvider],
  );

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Model Providers</h2>
      <p className="settings-section__desc">
        Bring your own key for Anthropic, OpenAI, Google, or a local Ollama server. Non-Cursor
        models are chat-only (Ask mode) — they have no tool-use, file editing, or terminal access.
      </p>

      {providers.length > 0 && (
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border-subtle p-2.5"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-md font-medium text-text-primary">{p.name}</span>
                <span className="text-2xs text-text-tertiary">
                  {PROVIDER_LABELS[p.provider] ?? p.provider}
                  {" · "}
                  {p.models.length} model{p.models.length !== 1 ? "s" : ""}
                  {" · "}
                  {p.hasApiKey ? "key set" : "no key"}
                  {p.baseUrl ? ` · ${p.baseUrl}` : ""}
                  {testResult[p.id] ? ` · ${testResult[p.id]}` : ""}
                </span>
              </div>
              <div className="flex flex-none items-center gap-2">
                <button type="button" onClick={() => void handleTest(p)} className="settings-link">
                  Test
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(p)}
                  className="settings-link settings-link--danger"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-2xs text-text-tertiary">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Anthropic"
              className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 text-md text-text-primary"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-text-tertiary">
            Provider
            <Select
              value={provider}
              options={PROVIDER_OPTIONS}
              onChange={(v) => setProvider(v as AddableProviderKind)}
              ariaLabel="Provider type"
              className="h-control-md rounded-md border border-border-subtle px-2 text-md text-text-primary"
            />
          </label>
          {provider !== "ollama" && (
            <label className="flex flex-col gap-1 text-2xs text-text-tertiary">
              API Key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Stored in the macOS Keychain"
                className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 text-md text-text-primary"
                autoComplete="off"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-2xs text-text-tertiary">
            Base URL (optional)
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={provider === "ollama" ? "http://127.0.0.1:11434" : "Custom proxy URL"}
              className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 text-md text-text-primary"
            />
          </label>
          {formError ? <span className="text-2xs text-danger">{formError}</span> : null}
          <div className="flex items-center gap-2">
            <button type="submit" className="settings-link" disabled={submitting}>
              {submitting ? "Adding…" : "Add Provider"}
            </button>
            <button type="button" onClick={reset} className="settings-link">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setShowForm(true)} className="settings-link mt-2">
          + Add Provider
        </button>
      )}
    </section>
  );
}
