import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pino } from "pino";
import { REDACT_CONFIG, redactCsrfFromUrl, safeReqSerializer } from "../logger.js";

/**
 * Phase 14 — comprehensive secret-redaction audit. Builds a synthetic
 * "everything at once" payload — top-level secrets, nested config blocks,
 * HTTP request headers, multi-case Authorization, CSRF in URL — and
 * asserts every named field censors to `[REDACTED]`.
 *
 * Why this is a separate file from `logger.test.ts`:
 *   - logger.test.ts covers individual paths and gives a focused failure when
 *     someone removes a redact path.
 *   - This audit covers the full fixture spec §11 prescribes: the kind of
 *     object you'd actually accidentally log via `logger.info(req.body)`
 *     during a debugging session. If this test ever passes raw values
 *     through, the redaction policy is incomplete.
 */

function captureLogs(): { sink: Writable; getLines: () => string[] } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString("utf8"));
      cb();
    },
  });
  return { sink, getLines: () => lines };
}

describe("Phase 14 redaction audit", () => {
  it("redacts every sensitive field in the full fixture", () => {
    const { sink, getLines } = captureLogs();
    const log = pino({ level: "info", redact: REDACT_CONFIG }, sink);
    log.info(
      {
        apiKey: "sk-secret-AAAA",
        CURSOR_API_KEY: "sk-secret-BBBB",
        Authorization: "Bearer top-level-token",
        headers: {
          Authorization: "Bearer header-CCCC",
          authorization: "Bearer header-DDDD",
          "X-CSRF-Token": "csrf-EEEE",
          "x-csrf-token": "csrf-FFFF",
        },
        config: {
          mcp: { token: "mcp-secret-GGGG", secret: "mcp-other-HHHH" },
          db: { password: "pg-pw-IIII", key: "pg-key-JJJJ" },
        },
        upstream: {
          token: "up-KKKK",
          secret: "up-LLLL",
          password: "up-MMMM",
          key: "up-NNNN",
        },
      },
      "audit-fixture",
    );

    const raw = getLines()[0]!;
    const payload = JSON.parse(raw) as Record<string, unknown>;

    // Top-level.
    expect(payload.apiKey).toBe("[REDACTED]");
    expect(payload.CURSOR_API_KEY).toBe("[REDACTED]");
    expect(payload.Authorization).toBe("[REDACTED]");

    // Headers — case variants both covered.
    const headers = payload.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe("[REDACTED]");
    expect(headers.authorization).toBe("[REDACTED]");
    expect(headers["X-CSRF-Token"]).toBe("[REDACTED]");
    expect(headers["x-csrf-token"]).toBe("[REDACTED]");

    // Nested config — wildcard *.token / *.secret / *.password / *.key.
    const config = payload.config as Record<string, Record<string, unknown>>;
    expect(config.mcp?.token).toBe("[REDACTED]");
    expect(config.mcp?.secret).toBe("[REDACTED]");
    expect(config.db?.password).toBe("[REDACTED]");
    expect(config.db?.key).toBe("[REDACTED]");

    // Wildcard *.token / *.secret / *.password / *.key applies one level deep.
    const upstream = payload.upstream as Record<string, unknown>;
    expect(upstream.token).toBe("[REDACTED]");
    expect(upstream.secret).toBe("[REDACTED]");
    expect(upstream.password).toBe("[REDACTED]");
    expect(upstream.key).toBe("[REDACTED]");

    // Guard rail: assert the raw string never contains any of the
    // sentinel values, in case the redactor missed a path but the
    // structured assertions above happened to match by coincidence.
    for (const sentinel of [
      "sk-secret-AAAA",
      "sk-secret-BBBB",
      "Bearer top-level-token",
      "Bearer header-CCCC",
      "Bearer header-DDDD",
      "csrf-EEEE",
      "csrf-FFFF",
      "mcp-secret-GGGG",
      "mcp-other-HHHH",
      "pg-pw-IIII",
      "pg-key-JJJJ",
      "up-KKKK",
      "up-LLLL",
      "up-MMMM",
      "up-NNNN",
    ]) {
      expect(raw).not.toContain(sentinel);
    }
  });

  it("redactCsrfFromUrl strips the csrf query param from a WS upgrade URL", () => {
    expect(redactCsrfFromUrl("/ws?csrf=abc123")).toBe("/ws?csrf=[REDACTED]");
    expect(redactCsrfFromUrl("/ws?foo=bar&csrf=abc&baz=qux")).toBe(
      "/ws?foo=bar&csrf=[REDACTED]&baz=qux",
    );
    expect(redactCsrfFromUrl("/ws?CSRF=mixedcase")).toBe("/ws?csrf=[REDACTED]");
    expect(redactCsrfFromUrl("/api/health")).toBe("/api/health");
  });

  it("safeReqSerializer routes the URL through the CSRF scrubber", () => {
    const out = safeReqSerializer({
      id: 7,
      method: "GET",
      url: "/ws?csrf=peep",
      headers: { authorization: "Bearer xyz" },
      remoteAddress: "127.0.0.1",
    });
    expect(out.url).toBe("/ws?csrf=[REDACTED]");
    // The serializer doesn't redact headers itself — that's the Pino
    // redact paths' job — but the URL leak is closed.
  });
});
