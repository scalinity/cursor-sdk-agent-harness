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
  readonly requestId: string | null;
  constructor(
    message: string,
    status: number,
    code: string | null,
    body: TBody | null,
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.body = body;
    this.requestId = requestId;
  }
}

/**
 * Generate an X-Request-Id for server-log correlation. Uses crypto.randomUUID
 * where available (every modern browser), falling back to a Math.random hex
 * for non-secure contexts where crypto.randomUUID is undefined.
 */
function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
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
  const requestId = newRequestId();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Request-Id": requestId,
  };
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
        requestId,
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
      requestId,
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
      requestId,
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
        requestId,
      );
    }
    return result.data as TResp extends ZodTypeAny ? z.infer<TResp> : unknown;
  }
  return parsedBody as TResp extends ZodTypeAny ? z.infer<TResp> : unknown;
}

/**
 * The set of HttpError codes that indicate a recoverable CSRF failure —
 * a fresh token would let the call succeed. Used by the mutating-request
 * helper to decide whether to refresh and retry once.
 */
export const CSRF_RECOVERABLE_CODES = new Set<string>([
  "CSRF_TOKEN_MISSING", // local — token wasn't bootstrapped yet
  "CSRF_FAILED", // server — token rejected (expired or invalidated)
]);

export interface MutatingRequestOptions<TResp extends ZodTypeAny | undefined = undefined>
  extends Omit<HttpRequestOptions<TResp>, "csrfToken"> {
  /** Reader for the current CSRF token; called twice (initial + after refresh). */
  getCsrfToken: () => string | null;
  /** Refreshes the CSRF token and returns the new value (or null on failure). */
  refreshCsrfToken: () => Promise<string | null>;
}

/**
 * Issues a mutating request, retrying once on CSRF failure after refreshing
 * the token. This centralizes the cold-load race (user clicks Send before
 * CSRF bootstrap completes) and the 4h-expiry recovery in one place so
 * mutating callers stay free of CSRF lifecycle logic.
 */
export async function mutatingRequest<TResp extends ZodTypeAny | undefined = undefined>(
  path: string,
  options: MutatingRequestOptions<TResp>,
): Promise<TResp extends ZodTypeAny ? z.infer<TResp> : unknown> {
  const { getCsrfToken, refreshCsrfToken, ...rest } = options;
  const buildRequest = (token: string | null): HttpRequestOptions<TResp> => {
    const next: HttpRequestOptions<TResp> = {
      method: rest.method ?? "POST",
      csrfToken: token,
    };
    if (rest.body !== undefined) next.body = rest.body;
    if (rest.query !== undefined) next.query = rest.query;
    if (rest.responseSchema !== undefined) next.responseSchema = rest.responseSchema;
    if (rest.signal !== undefined) next.signal = rest.signal;
    return next;
  };

  try {
    return await httpRequest(path, buildRequest(getCsrfToken()));
  } catch (e) {
    if (!(e instanceof HttpError) || !e.code || !CSRF_RECOVERABLE_CODES.has(e.code)) {
      throw e;
    }
    // Refresh-and-retry exactly once. If the refresh fails or yields no
    // token, surface the original error so the caller can show a banner.
    const refreshed = await refreshCsrfToken();
    if (!refreshed) throw e;
    return await httpRequest(path, buildRequest(refreshed));
  }
}
