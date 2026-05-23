import { z } from "zod";
import type { CanonicalRunEvent } from "../../state/run-store.js";
import { safePayload } from "../../lib/safe-payload.js";

const userPayloadSchema = z
  .object({
    role: z.literal("user").optional(),
    content: z
      .array(z.object({ type: z.string(), text: z.string().optional() }))
      .optional(),
  })
  .nullable();

export interface UserMessageProps {
  event: CanonicalRunEvent;
}

/**
 * Minimal user-message render — Phase 09 expands with avatar/timestamp polish.
 * Payload is Zod-validated at the renderer boundary (RV2-W18) so a corrupt
 * row or future SDK shape change degrades to "(empty)" instead of crashing.
 */
export function UserMessage({ event }: UserMessageProps) {
  const payload = safePayload(event.payload, userPayloadSchema);
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
