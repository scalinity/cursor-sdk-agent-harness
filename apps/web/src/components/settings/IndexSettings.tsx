import { useState } from "react";
import { useIndexStatus } from "../../hooks/useIndexStatus.js";

const STATUS_LABELS: Record<string, string> = {
  pending: "Not indexed",
  indexing: "Indexing…",
  indexed: "Indexed",
  error: "Error",
  stale: "Stale (changes pending)",
};

export function IndexSettings() {
  const { status, reindex } = useIndexStatus();
  const [busy, setBusy] = useState(false);

  const onReindex = async () => {
    setBusy(true);
    try {
      await reindex();
    } finally {
      setBusy(false);
    }
  };

  const pct =
    status && status.totalFiles > 0
      ? Math.round((status.indexedFiles / status.totalFiles) * 100)
      : 0;

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Semantic Index</h2>
      <p className="settings-section__desc">
        Vector embeddings of your workspace power @codebase semantic search. Runs in-process; the
        model downloads once on first use.
      </p>
      <div className="flex flex-col gap-1 text-2xs text-text-tertiary">
        <span>
          Status: <span className="text-text-primary">{STATUS_LABELS[status?.status ?? "pending"]}</span>
          {status?.status === "indexing" && status.totalFiles > 0 ? ` (${pct}%)` : ""}
        </span>
        <span>
          {status?.indexedFiles ?? 0}/{status?.totalFiles ?? 0} files · {status?.totalChunks ?? 0} chunks
        </span>
        {status?.lastIndexedAt ? (
          <span>Last indexed: {new Date(status.lastIndexedAt).toLocaleString()}</span>
        ) : null}
        {status?.errorMessage ? (
          <span className="text-danger">{status.errorMessage}</span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => void onReindex()}
        className="settings-link mt-2"
        disabled={busy || status?.status === "indexing"}
      >
        {busy || status?.status === "indexing" ? "Indexing…" : "Re-index workspace"}
      </button>
    </section>
  );
}
