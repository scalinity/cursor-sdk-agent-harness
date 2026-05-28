import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { KeychainDriver } from "./keytar-driver.js";

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function decodeSegment(value: string): string {
  return decodeURIComponent(value);
}

function secretFileName(service: string, account: string): string {
  return `${encodeSegment(service)}__${encodeSegment(account)}.secret`;
}

function parseSecretFileName(fileName: string): { service: string; account: string } | null {
  if (!fileName.endsWith(".secret")) return null;
  const stem = fileName.slice(0, -".secret".length);
  const separator = stem.indexOf("__");
  if (separator <= 0) return null;
  const service = decodeSegment(stem.slice(0, separator));
  const account = decodeSegment(stem.slice(separator + 2));
  if (service.length === 0 || account.length === 0) return null;
  return { service, account };
}

/**
 * CLI-owned secret store for environments where libsecret/keytar is unavailable
 * (headless Linux, Cloud Agent VMs). Secrets live under a single directory with
 * 0700 perms and 0600 files — same isolation posture as the CLI SQLite DB.
 */
export function createFileKeychainDriver(rootDir: string): KeychainDriver {
  async function ensureRoot(): Promise<void> {
    await mkdir(rootDir, { recursive: true, mode: 0o700 });
  }

  async function secretPath(service: string, account: string): Promise<string> {
    await ensureRoot();
    return path.join(rootDir, secretFileName(service, account));
  }

  async function writeSecret(targetPath: string, password: string): Promise<void> {
    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, password, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, targetPath);
  }

  return {
    async getPassword(service, account) {
      try {
        const value = await readFile(await secretPath(service, account), "utf8");
        return value.length > 0 ? value : null;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async setPassword(service, account, password) {
      await writeSecret(await secretPath(service, account), password);
    },
    async deletePassword(service, account) {
      try {
        await unlink(await secretPath(service, account));
        return true;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async findCredentials(service) {
      await ensureRoot();
      const entries = await readdir(rootDir, { withFileTypes: true });
      const matches: Array<{ account: string; password: string }> = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const parsed = parseSecretFileName(entry.name);
        if (!parsed || parsed.service !== service) continue;
        const password = await readFile(path.join(rootDir, entry.name), "utf8");
        matches.push({ account: parsed.account, password });
      }
      return matches;
    },
  };
}
