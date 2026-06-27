import type { McpServerConfig } from "@harness/shared";
import {
  parseMcpSecretRef,
  type McpSecretRefParts,
  type McpSecretStore,
} from "../keychain/mcp-secret-store.js";
import { ForeignMcpSecretRefError } from "./mcp-secret-errors.js";

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

function visitConfigStringFields(
  config: McpServerConfig,
  visitor: (path: readonly string[], value: string) => void,
): void {
  if ("command" in config) {
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        visitor(["env", key], value);
      }
    }
    return;
  }

  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      visitor(["headers", key], value);
    }
  }
  if (config.auth?.CLIENT_ID) {
    visitor(["auth", "CLIENT_ID"], config.auth.CLIENT_ID);
  }
  if (config.auth?.CLIENT_SECRET) {
    visitor(["auth", "CLIENT_SECRET"], config.auth.CLIENT_SECRET);
  }
}

export function assertOwnedMcpSecretRefs(config: McpServerConfig, serverId: string): void {
  visitConfigStringFields(config, (path, value) => {
    const ref = parseMcpSecretRef(value);
    if (ref !== null && !refMatchesPath(ref, serverId, path)) {
      throw new ForeignMcpSecretRefError(serverId, path, ref.serverId);
    }
  });
}

async function externalizeValue(
  store: McpSecretStore,
  serverId: string,
  path: readonly string[],
  value: string,
): Promise<{ value: string; wrote: boolean }> {
  const ref = parseMcpSecretRef(value);
  const matchesOwnPath = refMatchesPath(ref, serverId, path);
  if (ref !== null && !matchesOwnPath) {
    throw new ForeignMcpSecretRefError(serverId, path, ref.serverId);
  }
  // Already an owned ref to this exact field — leave it untouched.
  if (matchesOwnPath) return { value, wrote: false };
  return { value: await store.set(serverId, path, value), wrote: true };
}

interface SecretField {
  path: string[];
  value: string;
  /**
   * Write a new value to this field on the GIVEN config. The closure captures
   * only the field's location (its key), never a config object — so it can't
   * silently alias and mutate a caller's input. Callers that mutate pass a
   * clone explicitly (see externalize/hydrate); `collect` never calls `set`,
   * so the read path structurally cannot mutate.
   */
  set: (target: McpServerConfig, next: string) => void;
}

/**
 * The single traversal over a config's secret-BEARING string fields: `env`
 * entries with a secret-like key, `headers` with a secret-like key, and
 * `auth.CLIENT_SECRET`. One definition of "where the secrets live" shared by
 * externalize (map), hydrate (map), and collect (read).
 *
 * Distinct from `visitConfigStringFields` (every string field) which the
 * foreign-ref assert uses: that one must inspect non-secret fields too.
 */
function secretFields(config: McpServerConfig): SecretField[] {
  const fields: SecretField[] = [];
  if ("command" in config) {
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        if (isSecretEnvKey(key)) {
          fields.push({
            path: ["env", key],
            value,
            set: (target, next) => {
              if ("command" in target && target.env) target.env[key] = next;
            },
          });
        }
      }
    }
    return fields;
  }

  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (isSecretHeaderKey(key)) {
        fields.push({
          path: ["headers", key],
          value,
          set: (target, next) => {
            if (!("command" in target) && target.headers) target.headers[key] = next;
          },
        });
      }
    }
  }
  if (config.auth?.CLIENT_SECRET) {
    fields.push({
      path: ["auth", "CLIENT_SECRET"],
      value: config.auth.CLIENT_SECRET,
      set: (target, next) => {
        if (!("command" in target) && target.auth) target.auth.CLIENT_SECRET = next;
      },
    });
  }
  return fields;
}

export async function externalizeMcpSecrets(
  config: McpServerConfig,
  serverId: string,
  store: McpSecretStore,
): Promise<ExternalizedMcpSecrets> {
  assertOwnedMcpSecretRefs(config, serverId);
  const next = cloneConfig(config);
  let wroteSecrets = false;
  for (const field of secretFields(next)) {
    const result = await externalizeValue(store, serverId, field.path, field.value);
    field.set(next, result.value);
    wroteSecrets ||= result.wrote;
  }
  return { config: next, wroteSecrets };
}

export function collectMcpSecretRefPaths(
  config: McpServerConfig,
  serverId: string,
): string[][] {
  const paths: string[][] = [];
  for (const field of secretFields(config)) {
    if (refMatchesPath(parseMcpSecretRef(field.value), serverId, field.path)) {
      paths.push([...field.path]);
    }
  }
  return paths;
}

export async function hydrateMcpSecrets(
  config: McpServerConfig,
  serverId: string,
  store: McpSecretStore,
): Promise<McpServerConfig> {
  const next = cloneConfig(config);
  for (const field of secretFields(next)) {
    if (refMatchesPath(parseMcpSecretRef(field.value), serverId, field.path)) {
      field.set(next, await store.get(field.value));
    }
  }
  return next;
}
