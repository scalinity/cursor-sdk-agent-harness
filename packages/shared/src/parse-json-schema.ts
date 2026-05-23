import type { ZodTypeAny, z } from "zod";

/**
 * REVIEW-S4: shared helper for the "parse JSON text → validate with Zod
 * → return { value, error }" pattern used by JSON editors on the
 * frontend (McpServerEditor cloud/MCP configs) and by the server-side
 * MCP validator. Returning a discriminated outcome with a formatted
 * `error` string lets call sites surface a single line to the user
 * without each rebuilding the same Zod-issue formatting.
 *
 * Two call sites today (web McpServerEditor + server mcp-validator);
 * NewAgentDialog's CloudOptions editor (S3) becomes the third.
 */
export interface ParseJsonOutcome<T> {
  value: T | null;
  error: string | null;
}

export function parseJsonWithSchema<S extends ZodTypeAny>(
  text: string,
  schema: S,
): ParseJsonOutcome<z.infer<S>> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      value: null,
      error: e instanceof Error ? e.message : "invalid JSON",
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue ? issue.path.join(".") || "(root)" : "(root)";
    const message = issue ? issue.message : "shape mismatch";
    return {
      value: null,
      error: `${path}: ${message}`,
    };
  }
  return { value: parsed.data as z.infer<S>, error: null };
}
