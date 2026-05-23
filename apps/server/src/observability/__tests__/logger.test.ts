import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pino } from "pino";
import { REDACT_CONFIG, redactCsrfFromUrl, safeReqSerializer } from "../logger.js";

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

describe("logger redaction", () => {
  it("redacts apiKey at the top level", () => {
    const { sink, getLines } = captureLogs();
    const log = pino({ level: "info", redact: REDACT_CONFIG }, sink);
    log.info({ apiKey: "sk-secret-XXXX" }, "diag");
    const payload = JSON.parse(getLines()[0]!);
    expect(payload.apiKey).toBe("[REDACTED]");
  });

  it("redacts CURSOR_API_KEY", () => {
    const { sink, getLines } = captureLogs();
    const log = pino({ level: "info", redact: REDACT_CONFIG }, sink);
    log.info({ CURSOR_API_KEY: "sk-secret-yyyy" }, "diag");
    const payload = JSON.parse(getLines()[0]!);
    expect(payload.CURSOR_API_KEY).toBe("[REDACTED]");
  });

  it("redacts nested *.token / *.secret / *.password / *.key", () => {
    const { sink, getLines } = captureLogs();
    const log = pino({ level: "info", redact: REDACT_CONFIG }, sink);
    log.info(
      {
        config: { mcp: { token: "abc" } },
        upstream: { secret: "def", password: "ghi", key: "jkl" },
      },
      "diag",
    );
    const payload = JSON.parse(getLines()[0]!);
    expect(payload.config.mcp.token).toBe("[REDACTED]");
    expect(payload.upstream.secret).toBe("[REDACTED]");
    expect(payload.upstream.password).toBe("[REDACTED]");
    expect(payload.upstream.key).toBe("[REDACTED]");
  });

  it("redacts CSRF and Authorization headers under headers.*", () => {
    const { sink, getLines } = captureLogs();
    const log = pino({ level: "info", redact: REDACT_CONFIG }, sink);
    log.info(
      {
        headers: {
          authorization: "Bearer abc",
          "x-csrf-token": "csrf-XXXX",
        },
      },
      "diag",
    );
    const payload = JSON.parse(getLines()[0]!);
    expect(payload.headers.authorization).toBe("[REDACTED]");
    expect(payload.headers["x-csrf-token"]).toBe("[REDACTED]");
  });

  it("leaves non-secret fields untouched", () => {
    const { sink, getLines } = captureLogs();
    const log = pino({ level: "info", redact: REDACT_CONFIG }, sink);
    log.info({ requestId: "abc", durationMs: 42 }, "diag");
    const payload = JSON.parse(getLines()[0]!);
    expect(payload.requestId).toBe("abc");
    expect(payload.durationMs).toBe(42);
  });
});

describe("redactCsrfFromUrl", () => {
  it("scrubs the csrf query param value", () => {
    expect(redactCsrfFromUrl("/ws?csrf=ABC123")).toBe("/ws?csrf=[REDACTED]");
    expect(redactCsrfFromUrl("/ws?foo=1&csrf=ABC123")).toBe("/ws?foo=1&csrf=[REDACTED]");
    expect(redactCsrfFromUrl("/ws?csrf=ABC123&foo=1")).toBe("/ws?csrf=[REDACTED]&foo=1");
  });

  it("is case-insensitive on the param name (replacement uses canonical lowercase)", () => {
    expect(redactCsrfFromUrl("/ws?CSRF=ABC123")).toBe("/ws?csrf=[REDACTED]");
  });

  it("scrubs URL-encoded values", () => {
    expect(redactCsrfFromUrl("/ws?csrf=ABC%2Edef")).toBe("/ws?csrf=[REDACTED]");
  });

  it("leaves URLs without a csrf param untouched", () => {
    expect(redactCsrfFromUrl("/api/runs?after_seq=10")).toBe("/api/runs?after_seq=10");
  });
});

describe("safeReqSerializer", () => {
  it("scrubs csrf from the captured req.url", () => {
    const out = safeReqSerializer({
      id: 1,
      method: "GET",
      url: "/ws?csrf=token-XYZ-secret",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(out.url).toBe("/ws?csrf=[REDACTED]");
    // The original token literal must not appear anywhere in the
    // serialised output (defence-in-depth against future copy-paste
    // bugs that re-include the raw URL).
    expect(JSON.stringify(out)).not.toContain("token-XYZ-secret");
  });

  it("preserves non-sensitive fields", () => {
    const out = safeReqSerializer({
      id: "req-1",
      method: "POST",
      url: "/api/agents",
      headers: { origin: "http://127.0.0.1:5173" },
      remoteAddress: "127.0.0.1",
      remotePort: 5678,
    });
    expect(out).toMatchObject({
      id: "req-1",
      method: "POST",
      url: "/api/agents",
      remoteAddress: "127.0.0.1",
      remotePort: 5678,
    });
  });
});
