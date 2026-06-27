import { randomBytes } from "node:crypto";
import { getKeychainDriver } from "./keytar-driver.js";

/**
 * Base for Keychain secrets the harness mints itself on first use (the CSRF
 * seed, the local session secret) — as opposed to secrets a user supplies.
 *
 * `getOrCreate()` returns the stored value or generates a fresh 32-byte
 * base64url secret and persists it; `reset()` deletes it. Subclasses bind a
 * fixed account name, so the generate-on-miss logic lives in exactly one
 * place. Abstract so callers go through a named store (CsrfSecretStore,
 * LocalSessionSecretStore) rather than instantiating the base directly.
 */
export abstract class GeneratedSecretStore {
  protected constructor(
    private readonly service: string,
    private readonly account: string,
  ) {}

  async getOrCreate(): Promise<string> {
    const driver = getKeychainDriver();
    const existing = await driver.getPassword(this.service, this.account);
    if (existing && existing.length > 0) return existing;
    const fresh = randomBytes(32).toString("base64url");
    await driver.setPassword(this.service, this.account, fresh);
    return fresh;
  }

  async reset(): Promise<void> {
    const driver = getKeychainDriver();
    await driver.deletePassword(this.service, this.account);
  }
}
