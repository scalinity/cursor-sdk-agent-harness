import type { ExecutionMode } from "@harness/shared";
import { cn } from "../lib/cn.js";

export interface ModeToggleProps {
  value: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  disabled?: boolean;
}

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 2a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5H4v2l3-2h4.5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M7 1.5a.75.75 0 0 1 .75.75V3h2.75A1.5 1.5 0 0 1 12 4.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3h2.75V2.25A.75.75 0 0 1 7 1.5ZM5 6.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm4 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M7.75 1 3 8h3.5l-.25 5L11 6H7.5L7.75 1Z"
        fill="currentColor"
      />
    </svg>
  );
}

const MODES: Array<{ mode: ExecutionMode; label: string; Icon: typeof ChatBubbleIcon }> = [
  { mode: "ask", label: "Ask", Icon: ChatBubbleIcon },
  { mode: "agent", label: "Agent", Icon: BotIcon },
  { mode: "yolo", label: "YOLO", Icon: ZapIcon },
];

export function ModeToggle({ value, onChange, disabled }: ModeToggleProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
      {MODES.map(({ mode, label, Icon }) => {
        const selected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            onClick={() => onChange(mode)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              selected
                ? "bg-accent-primary text-surface-1"
                : "bg-surface-2 text-text-secondary hover:text-text-primary",
            )}
            aria-pressed={selected}
            aria-label={label}
          >
            <Icon className="size-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
