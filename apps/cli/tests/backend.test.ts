import { describe, expect, it } from "vitest";
import { buildEmbeddedServerEnvOverrides } from "../src/backend.js";
import { CLI_DB_PATH } from "../src/config.js";

describe("CLI backend", () => {
  it("boots the embedded server against the CLI-owned database", () => {
    const overrides = buildEmbeddedServerEnvOverrides("http://127.0.0.1:5173");

    expect(overrides).toMatchObject({
      LOG_LEVEL: "silent",
      WEB_ORIGIN: "http://127.0.0.1:5173",
      DB_PATH: CLI_DB_PATH,
    });
  });
});
