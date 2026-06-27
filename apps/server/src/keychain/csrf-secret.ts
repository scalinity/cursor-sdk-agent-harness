import { GeneratedSecretStore } from "./generated-secret-store.js";

export interface CsrfSecretStoreOptions {
  service: string;
}

/** Keychain-backed CSRF HMAC seed, generated on first use. */
export class CsrfSecretStore extends GeneratedSecretStore {
  constructor(opts: CsrfSecretStoreOptions) {
    super(opts.service, "csrf-secret");
  }
}
