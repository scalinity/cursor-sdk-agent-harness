import type { ContextSearchResult, ContextMentionKind } from "@harness/shared";
import { cn } from "../lib/cn.js";
import { FileIcon, FolderIcon, CodeIcon } from "./shell/ToolbarIcons.js";

export interface MentionAutocompleteProps {
  results: ContextSearchResult;
  selectedIndex: number;
  onSelect: (kind: ContextMentionKind, value: string, displayLabel: string) => void;
}

export function MentionAutocomplete({
  results,
  selectedIndex,
  onSelect,
}: MentionAutocompleteProps) {
  let idx = 0;

  const hasFiles = results.files.length > 0;
  const hasSymbols = results.symbols.length > 0;

  if (!hasFiles && !hasSymbols) {
    return (
      <div className="mention-autocomplete">
        <div className="mention-autocomplete__empty">No results</div>
      </div>
    );
  }

  return (
    <div className="mention-autocomplete">
      {hasFiles ? (
        <div className="mention-autocomplete__section">
          <div className="mention-autocomplete__section-label">Files & Folders</div>
          {results.files.map((f) => {
            const currentIdx = idx++;
            return (
              <button
                key={`${f.isDirectory ? "d" : "f"}-${f.path}`}
                type="button"
                className={cn(
                  "mention-autocomplete__item",
                  currentIdx === selectedIndex && "mention-autocomplete__item--selected",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(f.isDirectory ? "folder" : "file", f.path, f.name);
                }}
              >
                {f.isDirectory ? (
                  <FolderIcon className="size-3.5 shrink-0 text-text-tertiary" />
                ) : (
                  <FileIcon className="size-3.5 shrink-0 text-text-tertiary" />
                )}
                <span className="mention-autocomplete__name">{f.name}</span>
                <span className="mention-autocomplete__path mono">{f.path}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {hasSymbols ? (
        <div className="mention-autocomplete__section">
          <div className="mention-autocomplete__section-label">Symbols</div>
          {results.symbols.map((s) => {
            const currentIdx = idx++;
            return (
              <button
                key={`s-${s.path}-${s.name}-${s.line}`}
                type="button"
                className={cn(
                  "mention-autocomplete__item",
                  currentIdx === selectedIndex && "mention-autocomplete__item--selected",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect("symbol", s.name, s.name);
                }}
              >
                <CodeIcon className="size-3.5 shrink-0 text-text-tertiary" />
                <span className="mention-autocomplete__name">{s.name}</span>
                <span className="mention-autocomplete__kind mono">{s.kind}</span>
                <span className="mention-autocomplete__path mono">{s.path}:{s.line}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
