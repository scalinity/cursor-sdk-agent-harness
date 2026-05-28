import { createFileKeychainDriver } from "./file-driver.js";
import { setKeychainDriver } from "./keytar-driver.js";

/**
 * When `HARNESS_KEYCHAIN_DIR` is set (CLI embedded server), secrets are stored
 * in a local directory instead of libsecret/keytar. Desktop/Electron continues
 * to use the native Keychain by leaving this unset.
 */
export function configureKeychainDriverFromEnv(env: NodeJS.ProcessEnv): void {
  const dir = env.HARNESS_KEYCHAIN_DIR;
  if (typeof dir !== "string" || dir.length === 0) return;
  setKeychainDriver(createFileKeychainDriver(dir));
}
