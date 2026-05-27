import type { McpServerConfig } from "@harness/shared";
import { isMcpSecretRef, type McpSecretStore } from "../keychain/mcp-secret-store.js";

const SECRET_ENV_KEY_RE = /(?:token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key)/i;
const SECRET_HEADER_KEY_RE = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)$|(?:token|secret|api[_-]?key|password)/i;

function cloneConfig(config: McpServerConfig): McpServerConfig {
  return JSON.parse(JSON.stringify(config)) as McpServerConfig;
}

function isSecretEnvKey(key: string): boolean {
  return SECRET_ENV_KEY_RE.test(key);
}

function isSecretHeaderKey(key: string): boolean {
  return SECRET_HEADER_KEY_RE.test(key);
}

async function externalizeValue(
  store: McpSecretStore,
  serverId: string,
  path: readonly string[],
  value: string,
): Promise<string> {
  if (isMcpSecretRef(value)) return value;
  return store.set(serverId, path, value);
}

export async function externalizeMcpSecrets(
  config: McpServerConfig,
  serverId: string,
  store: McpSecretStore,
): Promise<McpServerConfig> {
  const next = cloneConfig(config);
  if ("command" in next) {
    if (next.env) {
      for (const [key, value] of Object.entries(next.env)) {
        if (isSecretEnvKey(key)) {
          next.env[key] = await externalizeValue(store, serverId, ["env", key], value);
        }
      }
    }
    return next;
  }

  if (next.headers) {
    for (const [key, value] of Object.entries(next.headers)) {
      if (isSecretHeaderKey(key)) {
        next.headers[key] = await externalizeValue(store, serverId, ["headers", key], value);
      }
    }
  }
  if (next.auth?.CLIENT_SECRET) {
    next.auth.CLIENT_SECRET = await externalizeValue(
      store,
      serverId,
      ["auth", "CLIENT_SECRET"],
      next.auth.CLIENT_SECRET,
    );
  }
  return next;
}

export async function hydrateMcpSecrets(
  config: McpServerConfig,
  store: McpSecretStore,
): Promise<McpServerConfig> {
  const next = cloneConfig(config);
  if ("command" in next) {
    if (next.env) {
      for (const [key, value] of Object.entries(next.env)) {
        if (isMcpSecretRef(value)) next.env[key] = await store.get(value);
      }
    }
    return next;
  }

  if (next.headers) {
    for (const [key, value] of Object.entries(next.headers)) {
      if (isMcpSecretRef(value)) next.headers[key] = await store.get(value);
    }
  }
  if (next.auth?.CLIENT_SECRET && isMcpSecretRef(next.auth.CLIENT_SECRET)) {
    next.auth.CLIENT_SECRET = await store.get(next.auth.CLIENT_SECRET);
  }
  return next;
}
