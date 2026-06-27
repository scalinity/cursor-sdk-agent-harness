import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpServerConfig } from "@harness/shared";
import {
  assertOwnedMcpSecretRefs,
  collectMcpSecretRefPaths,
  externalizeMcpSecrets,
  hydrateMcpSecrets,
} from "../mcp-secret-config.js";
import { ForeignMcpSecretRefError } from "../mcp-secret-errors.js";
import { McpSecretStore } from "../../keychain/mcp-secret-store.js";
import {
  createInMemoryKeychainDriver,
  resetKeychainDriverForTests,
  setKeychainDriver,
} from "../../keychain/testing.js";

const REF_PREFIX = "keychain:mcp-secret:";

describe("assertOwnedMcpSecretRefs", () => {
  it("rejects secret refs owned by another server", () => {
    const store = new McpSecretStore({ service: "test" });
    const foreignRef = store.refFor("other-server", ["headers", "Authorization"]);
    expect(() =>
      assertOwnedMcpSecretRefs(
        {
          url: "https://example.test",
          headers: { Authorization: foreignRef },
        },
        "this-server",
      ),
    ).toThrow(ForeignMcpSecretRefError);
  });

  it("allows refs that match the owning server and path", () => {
    const store = new McpSecretStore({ service: "test" });
    const ownRef = store.refFor("this-server", ["headers", "Authorization"]);
    expect(() =>
      assertOwnedMcpSecretRefs(
        {
          url: "https://example.test",
          headers: { Authorization: ownRef },
        },
        "this-server",
      ),
    ).not.toThrow();
  });
});

describe("externalize / hydrate / collect MCP secrets", () => {
  const SERVICE = "test";
  const SERVER = "srv";
  let store: McpSecretStore;

  beforeEach(() => {
    setKeychainDriver(createInMemoryKeychainDriver());
    store = new McpSecretStore({ service: SERVICE });
  });

  afterEach(() => {
    resetKeychainDriverForTests();
  });

  function httpHeaders(config: McpServerConfig): Record<string, string> {
    return (config as { headers?: Record<string, string> }).headers ?? {};
  }
  function httpAuth(config: McpServerConfig): { CLIENT_ID?: string; CLIENT_SECRET?: string } {
    return (config as { auth?: { CLIENT_ID?: string; CLIENT_SECRET?: string } }).auth ?? {};
  }
  function stdioEnv(config: McpServerConfig): Record<string, string> {
    return (config as { env?: Record<string, string> }).env ?? {};
  }

  it("externalize→hydrate round-trips a header secret to its plaintext", async () => {
    const config: McpServerConfig = {
      url: "https://example.test",
      headers: { Authorization: "Bearer plaintext-token" },
    };

    const { config: externalized, wroteSecrets } = await externalizeMcpSecrets(config, SERVER, store);
    expect(wroteSecrets).toBe(true);
    expect(httpHeaders(externalized).Authorization?.startsWith(REF_PREFIX)).toBe(true);

    const hydrated = await hydrateMcpSecrets(externalized, SERVER, store);
    expect(httpHeaders(hydrated).Authorization).toBe("Bearer plaintext-token");
  });

  it("externalizes auth.CLIENT_SECRET but leaves the non-secret CLIENT_ID untouched", async () => {
    const config: McpServerConfig = {
      url: "https://example.test",
      auth: { CLIENT_ID: "public-client-id", CLIENT_SECRET: "super-secret" },
    };

    const { config: externalized } = await externalizeMcpSecrets(config, SERVER, store);
    expect(httpAuth(externalized).CLIENT_ID).toBe("public-client-id");
    expect(httpAuth(externalized).CLIENT_SECRET?.startsWith(REF_PREFIX)).toBe(true);

    const hydrated = await hydrateMcpSecrets(externalized, SERVER, store);
    expect(httpAuth(hydrated).CLIENT_ID).toBe("public-client-id");
    expect(httpAuth(hydrated).CLIENT_SECRET).toBe("super-secret");
  });

  it("stdio: externalizes secret-named env vars, leaves non-secret env vars as-is", async () => {
    const config: McpServerConfig = {
      command: "server",
      env: { API_KEY: "sk-plaintext", PORT: "8080" },
    };

    const { config: externalized } = await externalizeMcpSecrets(config, SERVER, store);
    expect(stdioEnv(externalized).API_KEY?.startsWith(REF_PREFIX)).toBe(true);
    expect(stdioEnv(externalized).PORT).toBe("8080");

    const hydrated = await hydrateMcpSecrets(externalized, SERVER, store);
    expect(stdioEnv(hydrated).API_KEY).toBe("sk-plaintext");
    expect(stdioEnv(hydrated).PORT).toBe("8080");
  });

  it("collectMcpSecretRefPaths returns exactly the externalized paths, in traversal order", async () => {
    const config: McpServerConfig = {
      url: "https://example.test",
      headers: { Authorization: "Bearer t" },
      auth: { CLIENT_ID: "id", CLIENT_SECRET: "s" },
    };
    const { config: externalized } = await externalizeMcpSecrets(config, SERVER, store);

    expect(collectMcpSecretRefPaths(externalized, SERVER)).toEqual([
      ["headers", "Authorization"],
      ["auth", "CLIENT_SECRET"],
    ]);
    // Plaintext config has no owned refs yet.
    expect(collectMcpSecretRefPaths(config, SERVER)).toEqual([]);
  });

  it("re-externalizing an already-externalized config writes nothing (idempotent)", async () => {
    const config: McpServerConfig = {
      url: "https://example.test",
      headers: { Authorization: "Bearer t" },
    };

    const first = await externalizeMcpSecrets(config, SERVER, store);
    expect(first.wroteSecrets).toBe(true);

    const second = await externalizeMcpSecrets(first.config, SERVER, store);
    expect(second.wroteSecrets).toBe(false);
    expect(second.config).toEqual(first.config);
  });

  it("does not mutate the input config (externalize and hydrate clone)", async () => {
    const config: McpServerConfig = {
      url: "https://example.test",
      headers: { Authorization: "Bearer plaintext" },
    };

    const { config: externalized } = await externalizeMcpSecrets(config, SERVER, store);
    // Input left untouched even though secretFields.set writes back.
    expect(httpHeaders(config).Authorization).toBe("Bearer plaintext");

    await hydrateMcpSecrets(externalized, SERVER, store);
    expect(httpHeaders(externalized).Authorization?.startsWith(REF_PREFIX)).toBe(true);
  });
});
