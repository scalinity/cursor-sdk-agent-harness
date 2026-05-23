/**
 * Minimal fetch wrapper. Adds:
 *   - JSON body / Accept handling
 *   - `X-CSRF-Token` header on mutating requests
 *   - Optional Zod response validation
 *   - Typed error envelope on non-2xx responses
 *
 * Same-origin requests (Vite dev proxy) only. No retries — callers handle
 * retries via the hook that owns the call (e.g. `useRunHistory.reload`).
 */
import type { ZodTypeAny, z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class HttpError<TBody = unknown> extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: TBody | null;
  constructor(message: string, status: number, code: string | null, body: TBody | null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface HttpRequestOptions<TResp extends ZodTypeAny | undefined = undefined> {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  responseSchema?: TResp;
  /** Pass a stable token from `ui-store.csrfToken`. Required for mutating verbs. */
  csrfToken?: string | null;
  signal?: AbortSignal;
}

const MUTATING_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH", "DELETE"]);

function buildUrl(path: string, query: HttpRequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Issue an HTTP request to the harness server. Returns the parsed JSON
 * (validated through `responseSchema` if provided). Throws `HttpError`
 * on non-2xx or schema validation failure.
 */
export async function httpRequest<TResp extends ZodTypeAny | undefined = undefined>(
  path: string,
  options: HttpRequestOptions<TResp> = {},
): Promise<TResp extends ZodTypeAny ? z.infer<TResp> : unknown> {
  const method: HttpMethod = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (MUTATING_METHODS.has(method)) {
    if (!options.csrfToken) {
      throw new HttpError(
        `CSRF token missing for ${method} ${path}`,
        0,
        "CSRF_TOKEN_MISSING",
        null,
      );
    }
    headers["X-CSRF-Token"] = options.csrfToken;
  }

  const url = buildUrl(path, options.query);
  const init: RequestInit = {
    method,
    headers,
    credentials: "same-origin",
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    init.signal = options.signal;
  }
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    throw new HttpError(
      e instanceof Error ? e.message : "network error",
      0,
      "NETWORK_ERROR",
      null,
    );
  }

  const text = await resp.text();
  let parsedBody: unknown = null;
  if (text.length > 0) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }
  }

  if (!resp.ok) {
    const errBody = parsedBody as { code?: string; message?: string } | null;
    throw new HttpError(
      errBody?.message ?? `${method} ${path} failed (${resp.status})`,
      resp.status,
      errBody?.code ?? null,
      parsedBody,
    );
  }

  if (options.responseSchema) {
    const result = options.responseSchema.safeParse(parsedBody);
    if (!result.success) {
      throw new HttpError(
        `Response schema validation failed for ${path}`,
        resp.status,
        "SCHEMA_VALIDATION_FAILED",
        result.error.flatten(),
      );
    }
    return result.data as TResp extends ZodTypeAny ? z.infer<TResp> : unknown;
  }
  return parsedBody as TResp extends ZodTypeAny ? z.infer<TResp> : unknown;
}
