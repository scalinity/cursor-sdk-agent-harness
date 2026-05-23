import { randomBytes } from "node:crypto";
import { getKeychainDriver } from "./keytar-driver.js";

const ACCOUNT = "local-session-secret";

export interface LocalSessionSecretStoreOptions {
  service: string;
}

export class LocalSessionSecretStore {
  constructor(private readonly opts: LocalSessionSecretStoreOptions) {}

  async getOrCreate(): Promise<string> {
    const driver = getKeychainDriver();
    const existing = await driver.getPassword(this.opts.service, ACCOUNT);
    if (existing && existing.length > 0) return existing;
    const fresh = randomBytes(32).toString("base64url");
    await driver.setPassword(this.opts.service, ACCOUNT, fresh);
    return fresh;
  }

  async reset(): Promise<void> {
    const driver = getKeychainDriver();
    await driver.deletePassword(this.opts.service, ACCOUNT);
  }
}
