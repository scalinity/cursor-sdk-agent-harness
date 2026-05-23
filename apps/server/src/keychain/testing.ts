/**
 * Test-only helpers for the Keychain layer. Importing from this module from
 * production code is a smell — production should always go through
 * `getKeychainDriver()` and let it lazy-load `keytar`.
 */
export {
  createInMemoryKeychainDriver,
  setKeychainDriver,
  resetKeychainDriverForTests,
} from "./keytar-driver.js";
export type { KeychainDriver } from "./keytar-driver.js";
