import { GeneratedSecretStore } from "./generated-secret-store.js";

export interface LocalSessionSecretStoreOptions {
  service: string;
}

/** Keychain-backed local session secret, generated on first use. */
export class LocalSessionSecretStore extends GeneratedSecretStore {
  constructor(opts: LocalSessionSecretStoreOptions) {
    super(opts.service, "local-session-secret");
  }
}
