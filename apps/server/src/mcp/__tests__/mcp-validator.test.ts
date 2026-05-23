import { describe, expect, it } from "vitest";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  redactMcpConfig,
  validateMcpServerConfig,
} from "../mcp-validator.js";

interface FakeChild extends EventEmitter {
  stderr: Readable;
  stdout: Readable;
  kill: (signal?: string) => boolean;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = Readable.from([]);
  child.stdout = Readable.from([]);
  child.kill = () => true;
  return child;
}

describe("validateMcpServerConfig — schema", () => {
  it("returns invalid for malformed JSON shape", async () => {
    const result = await validateMcpServerConfig({ banana: 42 });
    expect(result.status).toBe("invalid");
  });

  it("returns invalid for missing both command and url", async () => {
    const result = await validateMcpServerConfig({ args: ["foo"] });
    expect(result.status).toBe("invalid");
  });

  it("returns invalid for non-URL url field", async () => {
    const result = await validateMcpServerConfig({ url: "not a url" });
    expect(result.status).toBe("invalid");
  });

  it("accepts the canonical stdio shape", async () => {
    const result = await validateMcpServerConfig(
      { command: "/bin/echo", args: ["hi"] },
      {
        spawnImpl: ((_cmd, _args, _opts) => {
          const child = makeFakeChild();
          queueMicrotask(() => child.emit("exit", 0, null));
          return child as unknown as ReturnType<typeof spawn>;
        }) as typeof spawn,
        timeoutMs: 500,
      },
    );
    expect(result.status).toBe("valid");
  });
});

describe("validateMcpServerConfig — stdio probe", () => {
  it("flags ENOENT as unreachable", async () => {
    const result = await validateMcpServerConfig(
      { command: "/nonexistent/binary" },
      {
        spawnImpl: ((_cmd, _args, _opts) => {
          const child = makeFakeChild();
          queueMicrotask(() =>
            child.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
          );
          return child as unknown as ReturnType<typeof spawn>;
        }) as typeof spawn,
        timeoutMs: 200,
      },
    );
    expect(result.status).toBe("unreachable");
    if (result.status === "unreachable") {
      expect(result.transport).toBe("stdio");
      expect(result.reason).toMatch(/ENOENT/);
    }
  });

  it("treats a long-running server (timeout) as valid", async () => {
    const result = await validateMcpServerConfig(
      { command: "/usr/bin/sleep", args: ["10"] },
      {
        spawnImpl: ((_cmd, _args, _opts) => {
          // never emit exit/error within the probe window — the validator
          // will time out and treat the running server as reachable.
          return makeFakeChild() as unknown as ReturnType<typeof spawn>;
        }) as typeof spawn,
        timeoutMs: 60,
      },
    );
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.details).toMatch(/long-running/);
    }
  });
});

describe("validateMcpServerConfig — http probe", () => {
  it("marks 2xx as valid", async () => {
    const result = await validateMcpServerConfig(
      { url: "https://example.test/mcp" },
      {
        fetchImpl: async () =>
          new Response("ok", { status: 200 }) as unknown as Response,
        timeoutMs: 500,
      },
    );
    expect(result.status).toBe("valid");
  });

  it("marks 4xx as invalid", async () => {
    const result = await validateMcpServerConfig(
      { url: "https://example.test/mcp" },
      {
        fetchImpl: async () =>
          new Response("forbidden", { status: 403 }) as unknown as Response,
        timeoutMs: 500,
      },
    );
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.reason).toMatch(/403/);
  });

  it("marks 5xx as invalid", async () => {
    const result = await validateMcpServerConfig(
      { url: "https://example.test/mcp" },
      {
        fetchImpl: async () =>
          new Response("boom", { status: 502 }) as unknown as Response,
        timeoutMs: 500,
      },
    );
    expect(result.status).toBe("invalid");
  });

  it("marks network failure as unreachable", async () => {
    const result = await validateMcpServerConfig(
      { url: "https://example.test/mcp" },
      {
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
        timeoutMs: 500,
      },
    );
    expect(result.status).toBe("unreachable");
    if (result.status === "unreachable") {
      expect(result.transport).toBe("http");
      expect(result.reason).toMatch(/ECONNREFUSED/);
    }
  });

  it("aborts on timeout and marks unreachable", async () => {
    const result = await validateMcpServerConfig(
      { url: "https://example.test/mcp" },
      {
        fetchImpl: ((_url, init) => {
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () => {
              const err = new DOMException("aborted", "AbortError");
              reject(err);
            });
          });
        }) as typeof fetch,
        timeoutMs: 60,
      },
    );
    expect(result.status).toBe("unreachable");
    if (result.status === "unreachable") expect(result.reason).toMatch(/timed out/);
  });
});

describe("REVIEW-W3 env allowlist", () => {
  it("does not pass non-allowlisted parent env vars to the child", async () => {
    const originalSecret = process.env.CURSOR_API_KEY;
    const originalPath = process.env.PATH;
    process.env.CURSOR_API_KEY = "sk-should-not-leak";
    let observedEnv: NodeJS.ProcessEnv | undefined;
    await validateMcpServerConfig(
      { command: "/usr/bin/echo", env: { MCP_OWN_VAR: "hello" } },
      {
        spawnImpl: ((_cmd, _args, opts) => {
          observedEnv = opts?.env as NodeJS.ProcessEnv | undefined;
          const child = makeFakeChild();
          queueMicrotask(() => child.emit("exit", 0, null));
          return child as unknown as ReturnType<typeof spawn>;
        }) as typeof spawn,
        timeoutMs: 200,
      },
    );
    expect(observedEnv).toBeDefined();
    if (originalSecret === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = originalSecret;
    expect(observedEnv?.CURSOR_API_KEY).toBeUndefined();
    expect(observedEnv?.MCP_OWN_VAR).toBe("hello");
    // PATH is on the allowlist — present.
    if (originalPath !== undefined) {
      expect(observedEnv?.PATH).toBe(originalPath);
    }
  });
});

describe("redactMcpConfig", () => {
  it("masks every stdio env var", () => {
    const masked = redactMcpConfig({
      command: "node",
      env: { GITHUB_TOKEN: "ghp_abcdef", NORMAL_VAR: "fine" },
    });
    if ("env" in masked && masked.env) {
      expect(masked.env.GITHUB_TOKEN).toBe("[REDACTED]");
      expect(masked.env.NORMAL_VAR).toBe("[REDACTED]");
    } else {
      throw new Error("expected env on stdio config");
    }
  });

  it("masks token-bearing headers and auth.CLIENT_SECRET", () => {
    const masked = redactMcpConfig({
      url: "https://example.test",
      headers: { Authorization: "Bearer abc", "X-Trace": "fine" },
      auth: { CLIENT_ID: "id", CLIENT_SECRET: "shh", scopes: ["read"] },
    });
    if ("headers" in masked && masked.headers) {
      expect(masked.headers.Authorization).toBe("[REDACTED]");
      expect(masked.headers["X-Trace"]).toBe("fine");
    } else {
      throw new Error("expected headers on http config");
    }
    if ("auth" in masked && masked.auth) {
      expect(masked.auth.CLIENT_ID).toBe("id");
      expect(masked.auth.CLIENT_SECRET).toBe("[REDACTED]");
      expect(masked.auth.scopes).toEqual(["read"]);
    } else {
      throw new Error("expected auth on http config");
    }
  });

  it("returns a structural clone, never mutates the input", () => {
    const original = {
      url: "https://example.test",
      headers: { Authorization: "tok" },
      auth: { CLIENT_ID: "id", CLIENT_SECRET: "shh" },
    };
    redactMcpConfig(original);
    expect(original.headers.Authorization).toBe("tok");
    expect(original.auth.CLIENT_SECRET).toBe("shh");
  });
});

describe("MCP_PROBE_TIMEOUT_MS clamp", () => {
  // The validator clamps any sub-50ms request to 50ms — silently swallowing
  // a 0/negative value would defeat the timeout. We exercise the clamp via
  // a fetchImpl that aborts when signaled and assert the abort fires.
  it("clamps a 0ms timeout up to a non-zero internal minimum", async () => {
    const result = await validateMcpServerConfig(
      { url: "https://example.test/mcp" },
      {
        fetchImpl: ((_url, init) => {
          return new Promise<Response>((_resolve, reject) => {
            (init?.signal as AbortSignal | undefined)?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
            );
          });
        }) as typeof fetch,
        timeoutMs: 0,
      },
    );
    expect(result.status).toBe("unreachable");
  });
});
