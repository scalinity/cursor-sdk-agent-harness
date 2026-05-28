import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileKeychainDriver } from "../file-driver.js";

describe("createFileKeychainDriver", () => {
  let rootDir: string | null = null;

  afterEach(async () => {
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
      rootDir = null;
    }
  });

  it("stores, reads, deletes, and finds credentials by service", async () => {
    rootDir = await mkdtemp(join(tmpdir(), "harness-file-keychain-"));
    const driver = createFileKeychainDriver(rootDir);

    expect(await driver.getPassword("cursor-sdk-agent-harness", "csrf-secret")).toBeNull();

    await driver.setPassword("cursor-sdk-agent-harness", "csrf-secret", "secret-a");
    await driver.setPassword("cursor-sdk-agent-harness", "cursor-api-key", "key-b");
    await driver.setPassword("other-service", "cursor-api-key", "other");

    expect(await driver.getPassword("cursor-sdk-agent-harness", "csrf-secret")).toBe("secret-a");
    expect(await driver.getPassword("cursor-sdk-agent-harness", "cursor-api-key")).toBe("key-b");
    expect(await driver.findCredentials("cursor-sdk-agent-harness")).toEqual([
      { account: "csrf-secret", password: "secret-a" },
      { account: "cursor-api-key", password: "key-b" },
    ]);

    expect(await driver.deletePassword("cursor-sdk-agent-harness", "csrf-secret")).toBe(true);
    expect(await driver.getPassword("cursor-sdk-agent-harness", "csrf-secret")).toBeNull();
    expect(await driver.deletePassword("cursor-sdk-agent-harness", "csrf-secret")).toBe(false);
  });
});
