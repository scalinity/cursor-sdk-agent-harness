import { Buffer } from "node:buffer";
import { getKeychainDriver } from "./keytar-driver.js";

const REF_PREFIX = "keychain:mcp-secret:";

export interface McpSecretStoreOptions {
  service: string;
}

export interface McpSecretRefParts {
  serverId: string;
  path: string[];
}

function encodePath(path: readonly string[]): string {
  return Buffer.from(JSON.stringify(path), "utf8").toString("base64url");
}

function decodePath(value: string): string[] {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((part) => typeof part === "string")) {
    throw new Error("Invalid MCP secret path reference");
  }
  return parsed;
}

export function parseMcpSecretRef(value: string): McpSecretRefParts | null {
  if (!value.startsWith(REF_PREFIX)) return null;
  const rest = value.slice(REF_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0) return null;
  try {
    return {
      serverId: rest.slice(0, separator),
      path: decodePath(rest.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

export function isMcpSecretRef(value: string): boolean {
  return parseMcpSecretRef(value) !== null;
}

export class McpSecretStore {
  constructor(private readonly opts: McpSecretStoreOptions) {}

  refFor(serverId: string, path: readonly string[]): string {
    return `${REF_PREFIX}${serverId}:${encodePath(path)}`;
  }

  accountFor(serverId: string, path: readonly string[]): string {
    return `mcp:${serverId}:${encodePath(path)}`;
  }

  async set(serverId: string, path: readonly string[], value: string): Promise<string> {
    const driver = getKeychainDriver();
    await driver.setPassword(this.opts.service, this.accountFor(serverId, path), value);
    return this.refFor(serverId, path);
  }

  async delete(serverId: string, path: readonly string[]): Promise<void> {
    const driver = getKeychainDriver();
    await driver.deletePassword(this.opts.service, this.accountFor(serverId, path));
  }

  async get(ref: string): Promise<string> {
    const parsed = parseMcpSecretRef(ref);
    if (!parsed) return ref;
    const driver = getKeychainDriver();
    const value = await driver.getPassword(
      this.opts.service,
      this.accountFor(parsed.serverId, parsed.path),
    );
    if (value === null) {
      throw new Error(`Missing MCP secret for server ${parsed.serverId}`);
    }
    return value;
  }

  async deleteServer(serverId: string): Promise<void> {
    const driver = getKeychainDriver();
    const prefix = `mcp:${serverId}:`;
    const credentials = await driver.findCredentials(this.opts.service);
    await Promise.all(
      credentials
        .filter((credential) => credential.account.startsWith(prefix))
        .map((credential) => driver.deletePassword(this.opts.service, credential.account)),
    );
  }
}
