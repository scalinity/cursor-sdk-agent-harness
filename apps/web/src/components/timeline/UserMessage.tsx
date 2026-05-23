import type { CanonicalRunEvent } from "../../state/run-store.js";

export interface UserMessageProps {
  event: CanonicalRunEvent;
}

/**
 * Minimal user-message render — Phase 09 expands with avatar/timestamp polish.
 */
export function UserMessage({ event }: UserMessageProps) {
  const payload = event.payload as { content?: Array<{ type: string; text?: string }> } | null;
  const text =
    payload?.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("") ?? "";
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-text-primary">User</span>
        <span className="mono text-xs text-text-tertiary">
          {new Date(event.occurred_at).toLocaleTimeString()}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-base leading-relaxed text-text-secondary">
        {text || "(empty)"}
      </div>
    </div>
  );
}
