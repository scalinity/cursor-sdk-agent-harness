import type { McpServerConfig } from "@harness/shared";
import {
  parseMcpSecretRef,
  type McpSecretRefParts,
  type McpSecretStore,
} from "../keychain/mcp-secret-store.js";

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

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

function refMatchesPath(
  ref: McpSecretRefParts | null,
  serverId: string,
  path: readonly string[],
): boolean {
  return ref !== null && ref.serverId === serverId && samePath(ref.path, path);
}

export interface ExternalizedMcpSecrets {
  config: McpServerConfig;
  wroteSecrets: boolean;
}

async function externalizeValue(
  store: McpSecretStore,
  serverId: string,
  path: readonly string[],
  value: string,
): Promise<{ value: string; wrote: boolean }> {
  const ref = parseMcpSecretRef(value);
  if (refMatchesPath(ref, serverId, path)) return { value, wrote: false };
  return { value: await store.set(serverId, path, value), wrote: true };
}

export async function externalizeMcpSecrets(
  config: McpServerConfig,
  serverId: string,
  store: McpSecretStore,
): Promise<ExternalizedMcpSecrets> {
  const next = cloneConfig(config);
  let wroteSecrets = false;
  if ("command" in next) {
    if (next.env) {
      for (const [key, value] of Object.entries(next.env)) {
        if (isSecretEnvKey(key)) {
          const result = await externalizeValue(store, serverId, ["env", key], value);
          next.env[key] = result.value;
          wroteSecrets ||= result.wrote;
        }
      }
    }
    return { config: next, wroteSecrets };
  }

  if (next.headers) {
    for (const [key, value] of Object.entries(next.headers)) {
      if (isSecretHeaderKey(key)) {
        const result = await externalizeValue(store, serverId, ["headers", key], value);
        next.headers[key] = result.value;
        wroteSecrets ||= result.wrote;
      }
    }
  }
  if (next.auth?.CLIENT_SECRET) {
    const result = await externalizeValue(
      store,
      serverId,
      ["auth", "CLIENT_SECRET"],
      next.auth.CLIENT_SECRET,
    );
    next.auth.CLIENT_SECRET = result.value;
    wroteSecrets ||= result.wrote;
  }
  return { config: next, wroteSecrets };
}

export function collectMcpSecretRefPaths(
  config: McpServerConfig,
  serverId: string,
): string[][] {
  const paths: string[][] = [];
  const collect = (value: string | undefined, path: readonly string[]) => {
    if (!value) return;
    const ref = parseMcpSecretRef(value);
    if (refMatchesPath(ref, serverId, path)) paths.push([...path]);
  };

  if ("command" in config) {
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        if (isSecretEnvKey(key)) collect(value, ["env", key]);
      }
    }
    return paths;
  }

  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (isSecretHeaderKey(key)) collect(value, ["headers", key]);
    }
  }
  collect(config.auth?.CLIENT_SECRET, ["auth", "CLIENT_SECRET"]);
  return paths;
}

export async function hydrateMcpSecrets(
  config: McpServerConfig,
  serverId: string,
  store: McpSecretStore,
): Promise<McpServerConfig> {
  const next = cloneConfig(config);
  if ("command" in next) {
    if (next.env) {
      for (const [key, value] of Object.entries(next.env)) {
        if (isSecretEnvKey(key) && refMatchesPath(parseMcpSecretRef(value), serverId, ["env", key])) {
          next.env[key] = await store.get(value);
        }
      }
    }
    return next;
  }

  if (next.headers) {
    for (const [key, value] of Object.entries(next.headers)) {
      if (isSecretHeaderKey(key) && refMatchesPath(parseMcpSecretRef(value), serverId, ["headers", key])) {
        next.headers[key] = await store.get(value);
      }
    }
  }
  if (
    next.auth?.CLIENT_SECRET &&
    refMatchesPath(parseMcpSecretRef(next.auth.CLIENT_SECRET), serverId, ["auth", "CLIENT_SECRET"])
  ) {
    next.auth.CLIENT_SECRET = await store.get(next.auth.CLIENT_SECRET);
  }
  return next;
}
