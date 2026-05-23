import { getKeychainDriver } from "./keytar-driver.js";

const ACCOUNT = "cursor-api-key";
export const API_KEY_MIN_LENGTH = 8;
export const API_KEY_MAX_LENGTH = 512;

export class InvalidApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidApiKeyError";
  }
}

export interface CursorApiKeyStoreOptions {
  service: string;
}

export class CursorApiKeyStore {
  constructor(private readonly opts: CursorApiKeyStoreOptions) {}

  async getApiKey(): Promise<string | null> {
    const driver = getKeychainDriver();
    return driver.getPassword(this.opts.service, ACCOUNT);
  }

  async setApiKey(value: string): Promise<void> {
    if (typeof value !== "string") {
      throw new InvalidApiKeyError("API key must be a string");
    }
    if (value.length < API_KEY_MIN_LENGTH) {
      throw new InvalidApiKeyError(
        `API key must be at least ${API_KEY_MIN_LENGTH} characters`,
      );
    }
    if (value.length > API_KEY_MAX_LENGTH) {
      throw new InvalidApiKeyError(
        `API key must be at most ${API_KEY_MAX_LENGTH} characters`,
      );
    }
    const driver = getKeychainDriver();
    await driver.setPassword(this.opts.service, ACCOUNT, value);
  }

  async deleteApiKey(): Promise<void> {
    const driver = getKeychainDriver();
    await driver.deletePassword(this.opts.service, ACCOUNT);
  }

  async hasApiKey(): Promise<boolean> {
    const value = await this.getApiKey();
    return value !== null && value.length > 0;
  }
}
