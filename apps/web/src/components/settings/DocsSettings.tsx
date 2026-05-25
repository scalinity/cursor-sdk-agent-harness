import { useCallback, useState } from "react";
import type { DocsSource } from "@harness/shared";
import { useDocsSources } from "../../hooks/useDocsSources.js";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  crawling: "Crawling…",
  indexed: "Indexed",
  error: "Error",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "docs-source-item__status--pending",
  crawling: "docs-source-item__status--crawling",
  indexed: "docs-source-item__status--indexed",
  error: "docs-source-item__status--error",
};

export function DocsSettings() {
  const { sources, addSource, deleteSource, recrawlSource } = useDocsSources();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(100);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !url.trim()) return;
      setSubmitting(true);
      try {
        await addSource({ name: name.trim(), baseUrl: url.trim(), maxPages });
        setName("");
        setUrl("");
        setMaxPages(100);
        setShowForm(false);
      } catch {
        // error handled in hook
      } finally {
        setSubmitting(false);
      }
    },
    [name, url, maxPages, addSource],
  );

  const handleDelete = useCallback(
    (source: DocsSource) => {
      if (confirm(`Delete "${source.name}" and all indexed pages?`)) {
        void deleteSource(source.id);
      }
    },
    [deleteSource],
  );

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Documentation Sources</h2>
      <p className="settings-section__desc">
        Index external documentation for @docs mentions in the Composer.
      </p>

      {sources.length > 0 && (
        <div className="docs-source-list">
          {sources.map((source) => (
            <div key={source.id} className="docs-source-item">
              <div className="docs-source-item__info">
                <span className="docs-source-item__name">{source.name}</span>
                <span className="docs-source-item__url">{source.baseUrl}</span>
                <span className="docs-source-item__meta">
                  <span
                    className={`docs-source-item__status ${STATUS_CLASS[source.status] ?? ""}`}
                  >
                    {STATUS_LABELS[source.status]}
                  </span>
                  {source.pageCount > 0 && (
                    <span className="docs-source-item__pages">
                      {source.pageCount} pages
                    </span>
                  )}
                  {source.errorMessage && (
                    <span className="docs-source-item__error">
                      {source.errorMessage}
                    </span>
                  )}
                </span>
              </div>
              <div className="docs-source-item__actions">
                <button
                  type="button"
                  onClick={() => void recrawlSource(source.id)}
                  className="settings-link"
                  disabled={source.status === "crawling"}
                >
                  Re-crawl
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(source)}
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
        <form onSubmit={handleSubmit} className="docs-add-form">
          <label className="docs-add-form__label">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fastify v5 Docs"
              className="docs-add-form__input"
              required
            />
          </label>
          <label className="docs-add-form__label">
            URL
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://fastify.dev/docs/latest/"
              className="docs-add-form__input"
              required
            />
          </label>
          <label className="docs-add-form__label">
            Max pages
            <input
              type="number"
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              min={1}
              max={500}
              className="docs-add-form__input docs-add-form__input--narrow"
            />
          </label>
          <div className="docs-add-form__actions">
            <button type="submit" className="settings-link" disabled={submitting}>
              {submitting ? "Adding…" : "Add Source"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="settings-link">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="settings-link"
        >
          + Add Documentation
        </button>
      )}
    </section>
  );
}
