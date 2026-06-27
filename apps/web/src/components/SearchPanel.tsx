import type { ComponentType, ReactNode } from "react";
import type {
  FileSearchResult,
  GrepSearchResult,
  SemanticSearchResult,
} from "@harness/shared";
import { useCodebaseSearch, type SearchType } from "../hooks/useCodebaseSearch.js";
import { cn } from "../lib/cn.js";
import { formatBytes } from "../lib/format.js";
import { FileIcon, SearchIcon, SparkIcon, type IconProps } from "./shell/ToolbarIcons.js";

const PLACEHOLDERS: Record<string, string> = {
  grep: "Search text in codebase…",
  files: "Search files by name…",
  semantic: "Search by meaning (semantic)…",
};

const SEARCH_TYPES: ReadonlyArray<{
  type: SearchType;
  label: string;
  title: string;
  Icon: ComponentType<IconProps>;
}> = [
  { type: "grep", label: "Text", title: "Text search", Icon: SearchIcon },
  { type: "files", label: "Files", title: "File name search", Icon: FileIcon },
  { type: "semantic", label: "Semantic", title: "Semantic search", Icon: SparkIcon },
];

function pluralSuffix(count: number): string {
  return count !== 1 ? "s" : "";
}

function GrepResults({ results }: { results: GrepSearchResult }) {
  return (
    <>
      <div className="search-panel__meta">
        {results.totalMatches} result{pluralSuffix(results.totalMatches)}
        {results.truncated ? " (truncated)" : ""}
        {" · "}
        {results.durationMs}ms
      </div>
      <div className="search-panel__results">
        {results.results.length === 0 ? (
          <div className="search-panel__empty">No matches found</div>
        ) : (
          results.results.map((r, i) => (
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
  );
}

function FileResults({ results }: { results: FileSearchResult }) {
  return (
    <div className="search-panel__results">
      {results.files.length === 0 ? (
        <div className="search-panel__empty">No files found</div>
      ) : (
        results.files.map((f) => (
          <div key={f.path} className="search-result">
            <div className="search-result__path">{f.path}</div>
            <div className="search-result__line">
              {f.name}
              {f.size > 0 ? ` (${formatBytes(f.size)})` : ""}
            </div>
          </div>
        ))
      )}
      {results.truncated ? (
        <div className="search-panel__meta">Results truncated</div>
      ) : null}
    </div>
  );
}

function SemanticResults({ results }: { results: SemanticSearchResult }) {
  return (
    <>
      <div className="search-panel__meta">
        {results.results.length} result{pluralSuffix(results.results.length)}
        {" · index "}
        {results.indexStatus.status}
        {" · "}
        {results.indexStatus.totalChunks} chunks
      </div>
      <div className="search-panel__results">
        {results.results.length === 0 ? (
          <div className="search-panel__empty">
            {results.indexStatus.status === "indexed"
              ? "No relevant code found"
              : "Index not ready yet — try again shortly"}
          </div>
        ) : (
          results.results.map((r, i) => (
            <div key={`${r.path}:${r.startLine}:${i}`} className="search-result">
              <div className="search-result__path">
                {r.path}:{r.startLine}-{r.endLine}
                <span className="search-result__score"> {Math.round(r.score * 100)}%</span>
              </div>
              <div className="search-result__line">{r.content.split("\n")[0]}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

export function SearchPanel() {
  const {
    query,
    setQuery,
    searchType,
    setSearchType,
    grepResults,
    fileResults,
    semanticResults,
    isSearching,
    error,
  } = useCodebaseSearch();

  function renderBody(): ReactNode {
    if (isSearching) return <div className="search-panel__empty">Searching…</div>;
    if (error) return <div className="search-panel__empty">{error}</div>;
    if (query.length === 0) {
      return (
        <div className="search-panel__empty">
          Search your codebase
          <br />
          <span className="text-2xs text-text-tertiary">
            {searchType === "semantic"
              ? "Describe what you're looking for in natural language"
              : "Try a function name, variable, or text pattern"}
          </span>
        </div>
      );
    }
    if (searchType === "grep" && grepResults) return <GrepResults results={grepResults} />;
    if (searchType === "files" && fileResults) return <FileResults results={fileResults} />;
    if (searchType === "semantic" && semanticResults) {
      return <SemanticResults results={semanticResults} />;
    }
    return null;
  }

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <input
          type="text"
          className="search-panel__input"
          placeholder={PLACEHOLDERS[searchType]}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="search-panel__toggle" role="radiogroup" aria-label="Search mode">
          {SEARCH_TYPES.map(({ type, label, title, Icon }) => {
            const active = searchType === type;
            return (
              <button
                key={type}
                type="button"
                className={cn(
                  "search-panel__toggle-btn",
                  active && "search-panel__toggle-btn--active",
                )}
                onClick={() => setSearchType(type)}
                aria-label={label}
                role="radio"
                aria-checked={active}
                title={title}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </div>

      {renderBody()}
    </div>
  );
}
