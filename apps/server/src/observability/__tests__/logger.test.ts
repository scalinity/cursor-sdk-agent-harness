import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pino } from "pino";
import { REDACT_CONFIG } from "../logger.js";

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
