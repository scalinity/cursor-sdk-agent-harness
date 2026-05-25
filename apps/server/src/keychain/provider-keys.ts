import { getKeychainDriver } from "./keytar-driver.js";

/**
 * Phase 23 — Keychain storage for BYOK provider API keys. Same service as the
 * Cursor key; one account per provider: `provider:{providerId}:api-key`.
 */

function account(providerId: string): string {
  return `provider:${providerId}:api-key`;
}

export interface ProviderKeyStoreOptions {
  service: string;
}

export class ProviderKeyStore {
  constructor(private readonly opts: ProviderKeyStoreOptions) {}

  get(providerId: string): Promise<string | null> {
    return getKeychainDriver().getPassword(this.opts.service, account(providerId));
  }

  set(providerId: string, value: string): Promise<void> {
    return getKeychainDriver().setPassword(this.opts.service, account(providerId), value);
  }

  async delete(providerId: string): Promise<void> {
    await getKeychainDriver().deletePassword(this.opts.service, account(providerId));
  }

  async has(providerId: string): Promise<boolean> {
    const v = await this.get(providerId);
    return v !== null && v.length > 0;
  }
}
