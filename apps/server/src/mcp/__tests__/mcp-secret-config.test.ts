import { describe, expect, it } from "vitest";
import { assertOwnedMcpSecretRefs } from "../mcp-secret-config.js";
import { ForeignMcpSecretRefError } from "../mcp-secret-errors.js";
import { McpSecretStore } from "../../keychain/mcp-secret-store.js";

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
