import type { ContextChip } from "@harness/shared";
import { FileIcon, FolderIcon, CodeIcon, SearchIcon, BookIcon, XIcon } from "./shell/ToolbarIcons.js";

export interface ContextChipBarProps {
  chips: ContextChip[];
  onRemove: (id: string) => void;
}

function formatTokenCount(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

function ChipIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "file":
      return <FileIcon className="size-3 shrink-0" />;
    case "folder":
      return <FolderIcon className="size-3 shrink-0" />;
    case "symbol":
      return <CodeIcon className="size-3 shrink-0" />;
    case "codebase":
      return <SearchIcon className="size-3 shrink-0" />;
    case "rules":
      return <BookIcon className="size-3 shrink-0" />;
    default:
      return <FileIcon className="size-3 shrink-0" />;
  }
}

export function ContextChipBar({ chips, onRemove }: ContextChipBarProps) {
  if (chips.length === 0) return null;

  const totalTokens = chips.reduce(
    (sum, c) => sum + (c.tokenEstimate ?? 0),
    0,
  );

  return (
    <div className="context-chip-bar">
      <div className="context-chip-bar__chips">
        {chips.map((chip) => (
          <span
            key={chip.id}
            className="context-chip"
            title={chip.mention.value}
          >
            <ChipIcon kind={chip.mention.kind} />
            <span className="context-chip__label">{chip.mention.displayLabel}</span>
            {chip.tokenEstimate ? (
              <span className="context-chip__tokens mono">
                ~{formatTokenCount(chip.tokenEstimate)}
              </span>
            ) : null}
            <button
              type="button"
              className="context-chip__remove"
              aria-label={`Remove ${chip.mention.displayLabel}`}
              onClick={() => onRemove(chip.id)}
            >
              <XIcon className="size-2.5" />
            </button>
          </span>
        ))}
      </div>
      {totalTokens > 0 ? (
        <span className="context-chip-bar__total mono">
          ~{formatTokenCount(totalTokens)} tokens
        </span>
      ) : null}
    </div>
  );
}
