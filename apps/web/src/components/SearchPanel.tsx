import { useCodebaseSearch } from "../hooks/useCodebaseSearch.js";
import { cn } from "../lib/cn.js";

export function SearchPanel() {
  const {
    query,
    setQuery,
    searchType,
    setSearchType,
    grepResults,
    fileResults,
    isSearching,
    error,
  } = useCodebaseSearch();

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <input
          type="text"
          className="search-panel__input"
          placeholder={searchType === "grep" ? "Search text in codebase…" : "Search files by name…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="search-panel__toggle">
          <button
            type="button"
            className={cn(
              "search-panel__toggle-btn",
              searchType === "grep" && "search-panel__toggle-btn--active",
            )}
            onClick={() => setSearchType("grep")}
          >
            Text
          </button>
          <button
            type="button"
            className={cn(
              "search-panel__toggle-btn",
              searchType === "files" && "search-panel__toggle-btn--active",
            )}
            onClick={() => setSearchType("files")}
          >
            Files
          </button>
        </div>
      </div>

      {isSearching ? (
        <div className="search-panel__empty">Searching…</div>
      ) : error ? (
        <div className="search-panel__empty">{error}</div>
      ) : query.length === 0 ? (
        <div className="search-panel__empty">
          Search your codebase
          <br />
          <span className="text-2xs text-text-tertiary">
            Try a function name, variable, or text pattern
          </span>
        </div>
      ) : searchType === "grep" && grepResults ? (
        <>
          <div className="search-panel__meta">
            {grepResults.totalMatches} result{grepResults.totalMatches !== 1 ? "s" : ""}
            {grepResults.truncated ? " (truncated)" : ""}
            {" · "}
            {grepResults.durationMs}ms
          </div>
          <div className="search-panel__results">
            {grepResults.results.length === 0 ? (
              <div className="search-panel__empty">No matches found</div>
            ) : (
              grepResults.results.map((r, i) => (
                <div key={`${r.path}:${r.line}:${i}`} className="search-result">
                  <div className="search-result__path">
                    {r.path}:{r.line}
                  </div>
                  {r.contextBefore.map((line, j) => (
                    <div key={`before-${j}`} className="search-result__context">
                      {line}
                    </div>
                  ))}
                  <div className="search-result__line">{r.content}</div>
                  {r.contextAfter.map((line, j) => (
                    <div key={`after-${j}`} className="search-result__context">
                      {line}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      ) : searchType === "files" && fileResults ? (
        <div className="search-panel__results">
          {fileResults.files.length === 0 ? (
            <div className="search-panel__empty">No files found</div>
          ) : (
            fileResults.files.map((f) => (
              <div key={f.path} className="search-result">
                <div className="search-result__path">{f.path}</div>
                <div className="search-result__line">
                  {f.name}
                  {f.size > 0 ? ` (${formatSize(f.size)})` : ""}
                </div>
              </div>
            ))
          )}
          {fileResults.truncated ? (
            <div className="search-panel__meta">Results truncated</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
