/**
 * Thin abstraction over `keytar` so tests can swap in an in-memory backend
 * without loading the native binding. The production driver lazy-loads
 * `keytar` via createRequire to keep the cold-path cost off the import graph.
 */

import { createRequire } from "node:module";

export interface KeychainDriver {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(
    service: string,
  ): Promise<Array<{ account: string; password: string }>>;
}

let _driver: KeychainDriver | null = null;

export function setKeychainDriver(driver: KeychainDriver): void {
  _driver = driver;
}

export function resetKeychainDriverForTests(): void {
  _driver = null;
}

const requireFromHere = createRequire(import.meta.url);

export class KeychainDriverLoadError extends Error {
  constructor(cause: unknown) {
    super(
      "Failed to load the `keytar` native binding. " +
        "Run `pnpm rebuild keytar` (and `npx prebuild-install` inside its dir) to rebuild it. " +
        `Original error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "KeychainDriverLoadError";
  }
}

export function getKeychainDriver(): KeychainDriver {
  if (_driver) return _driver;
  let keytar: KeychainDriver;
  try {
    keytar = requireFromHere("keytar") as KeychainDriver;
  } catch (err) {
    throw new KeychainDriverLoadError(err);
  }
  _driver = {
    getPassword: (service, account) => keytar.getPassword(service, account),
    setPassword: (service, account, password) =>
      keytar.setPassword(service, account, password),
    deletePassword: (service, account) =>
      keytar.deletePassword(service, account),
    findCredentials: (service) => keytar.findCredentials(service),
  };
  return _driver;
}

/**
 * In-memory driver used by unit tests. Keyed by `service::account`.
 */
export function createInMemoryKeychainDriver(): KeychainDriver {
  const store = new Map<string, string>();
  const k = (s: string, a: string) => `${s}::${a}`;
  return {
    async getPassword(service, account) {
      return store.get(k(service, account)) ?? null;
    },
    async setPassword(service, account, password) {
      store.set(k(service, account), password);
    },
    async deletePassword(service, account) {
      return store.delete(k(service, account));
    },
    async findCredentials(service) {
      const out: Array<{ account: string; password: string }> = [];
      for (const [key, password] of store) {
        const [svc, account] = key.split("::");
        if (svc === service && account !== undefined) {
          out.push({ account, password });
        }
      }
      return out;
    },
  };
}
