import { createFileKeychainDriver } from "./file-driver.js";
import { getKeychainDriver, setKeychainDriver, KeychainDriverLoadError } from "./keytar-driver.js";

/**
 * Keychain backend selection.
 *
 * Desktop/Electron leaves `HARNESS_KEYCHAIN_DIR` unset and uses the native
 * Keychain (keytar). The CLI's embedded server sets `HARNESS_KEYCHAIN_DIR` so a
 * headless host without libsecret/keytar can still boot — but when keytar IS
 * available (e.g. macOS) we PREFER it, so the CLI shares the same Cursor API key
 * the desktop app already stored rather than starting from an empty, isolated
 * file store. Without this, CLI model discovery and runs silently see no key and
 * fall back to the static model list. The file store at `HARNESS_KEYCHAIN_DIR`
 * is the fallback only when keytar genuinely can't load.
 *
 * (Run history stays isolated via `DB_PATH`; only the secret store is shared.)
 */
export function configureKeychainDriverFromEnv(env: NodeJS.ProcessEnv): void {
  const dir = env.HARNESS_KEYCHAIN_DIR;
  if (typeof dir !== "string" || dir.length === 0) return;
  try {
    // Probe keytar; on success this installs the native driver (the same
    // Keychain entry the desktop app writes to).
    getKeychainDriver();
  } catch (err) {
    if (err instanceof KeychainDriverLoadError) {
      setKeychainDriver(createFileKeychainDriver(dir));
      return;
    }
    throw err;
  }
}
