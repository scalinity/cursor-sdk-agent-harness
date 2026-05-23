import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  HOST: "127.0.0.1",
  PORT: "4783",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  LOG_LEVEL: "error",
  KEYCHAIN_SERVICE: "cursor-sdk-agent-harness-test",
  ALLOW_REMOTE_BIND: "false",
};

describe("buildApp", () => {
  it("registers health routes and responds to /api/health/live", async () => {
    const env = loadEnv(BASE_ENV);
    const app = await buildApp({ env });
    try {
      const res = await app.inject({ method: "GET", url: "/api/health/live" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });

  it("rejects non-loopback HOST without ALLOW_REMOTE_BIND", () => {
    expect(() =>
      loadEnv({ ...BASE_ENV, HOST: "0.0.0.0", ALLOW_REMOTE_BIND: "false" }),
    ).toThrow(/Non-loopback HOST requires/);
  });
});
