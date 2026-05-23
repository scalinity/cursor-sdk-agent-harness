/**
 * safePayload — runtime-validates an event payload at the renderer
 * boundary. The run-store stores `payload: unknown` by design (frame
 * validation happens at the WS edge, not at render). Without a guard
 * here, a future SDK upgrade or a corrupt DB row could silently slip
 * past the renderer's casts. The fallback returns `null` so callers
 * render the empty/placeholder state instead of crashing.
 *
 * Also exports a circular-safe `safeJsonString` for inspector views
 * (replaces the old `String(value)` fallback that produced "[object
 * Object]" for circular or BigInt-containing payloads).
 */
import type { ZodTypeAny, z } from "zod";

export function safePayload<TSchema extends ZodTypeAny>(
  payload: unknown,
  schema: TSchema,
): z.infer<TSchema> | null {
  const result = schema.safeParse(payload);
  return result.success ? result.data : null;
}

/**
 * Stringifies arbitrary values for inspector panels. Handles:
 *   - Circular references (replaces the cycle with "[Circular]")
 *   - BigInt (serialises as `<n>n` literal form)
 *   - undefined (renders as the string "undefined")
 *
 * Output is always a non-empty string; never throws.
 */
export function safeJsonString(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `${value.toString()}n`;
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, v: unknown) => {
        if (typeof v === "bigint") return `${v.toString()}n`;
        if (v && typeof v === "object") {
          if (seen.has(v as object)) return "[Circular]";
          seen.add(v as object);
        }
        return v;
      },
      2,
    );
  } catch {
    return String(value);
  }
}
