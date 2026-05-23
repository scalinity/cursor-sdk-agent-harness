import type { AgentOptions, McpServerConfig } from "@cursor/sdk";
import type {
  AgentRow,
  McpServerRow,
  SubagentDefinitionRow,
} from "@harness/shared";
// AgentRow used both for the public input type and the private requireCwd
// helper. `import type { AgentRow }` keeps it tree-shaken at runtime.
import type {
  WorkspaceDecision,
  WorkspacePolicy,
} from "../security/workspace-policy.js";

/**
 * Thrown when one or more of the candidate workspace cwds fails workspace
 * policy validation. `details` carries the raw decision per offending path so
 * the caller can surface an actionable error in the REST layer.
 */
export class WorkspaceRejectedError extends Error {
  readonly code = "WORKSPACE_REJECTED" as const;
  constructor(
    readonly details: ReadonlyArray<{
      input: string;
      decision: Extract<WorkspaceDecision, { allowed: false }>;
    }>,
  ) {
    const reasons = details
      .map((d) => `${d.input} → ${d.decision.reason}`)
      .join("; ");
    super(`Workspace policy rejected ${details.length} path(s): ${reasons}`);
    this.name = "WorkspaceRejectedError";
  }
}

/**
 * F-004: harness-internal model IDs do not match `@cursor/sdk@1.0.13`'s
 * `Cursor.models.list()` enum. The SDK rejects `composer-2-5-fast` /
 * `composer-2-5` with `Cannot use this model` because the real IDs use
 * dots and have no "fast" tier. Translate here at the boundary so the
 * harness schema, pricing keys, and settings rows can keep their
 * existing shapes (which carry the fast-vs-standard pricing distinction
 * for cost accounting). When the SDK schema stabilises, the harness
 * model IDs should be aligned to the SDK's literals and this map can
 * collapse.
 */
const HARNESS_TO_SDK_MODEL_ID: Record<string, string> = {
  "composer-2-5-fast": "composer-2.5",
  "composer-2-5": "composer-2",
};

function toSdkModelId(harnessModelId: string): string {
  return HARNESS_TO_SDK_MODEL_ID[harnessModelId] ?? harnessModelId;
}

export interface BuildAgentOptionsInput {
  agent: AgentRow;
  apiKey: string;
  mcpServers: ReadonlyArray<McpServerRow>;
  subagents: ReadonlyArray<SubagentDefinitionRow>;
  workspacePolicy: WorkspacePolicy;
}

/**
 * Translate a persisted agent row plus expanded MCP / subagent definitions
 * into the SDK's `AgentOptions` payload. The function:
 *
 * 1. Validates every `cwd` against the workspace policy and aborts with a
 *    `WorkspaceRejectedError` on the first batch of failures (all paths are
 *    checked so the caller sees every offender at once).
 * 2. Filters MCP servers to those marked `enabled = true` AND
 *    `validation_status = "valid"` (per spec §5 MCP Server CRUD).
 * 3. Filters subagents to those marked `enabled = true`.
 * 4. Materialises the local vs cloud variant per `agent.mode`.
 * 5. Resolves the cwd shape per spec §5 Multi-cwd: single-element arrays
 *    pass as `string`, anything else passes as `string[]`.
 *
 * The returned `AgentOptions` carries `agentId: agent.id` so the SDK uses
 * our durable identifier rather than minting its own.
 */
export async function buildAgentOptions(
  input: BuildAgentOptionsInput,
): Promise<AgentOptions> {
  const { agent, apiKey, mcpServers, subagents, workspacePolicy } = input;

  // REVIEW-S8: local-mode workspace validation. `localCwd` is undefined
  // for cloud mode and non-empty for local (requireCwd throws otherwise),
  // so the assembly below narrows correctly via `if (localCwd)` — no
  // cast needed.
  const localCwd: ReadonlyArray<string> | undefined =
    agent.mode === "local" ? requireCwd(agent) : undefined;
  if (localCwd) {
    const decisions = await Promise.all(
      localCwd.map(async (candidate) => ({
        input: candidate,
        decision: await workspacePolicy.check(candidate),
      })),
    );
    const failures: Array<{
      input: string;
      decision: Extract<WorkspaceDecision, { allowed: false }>;
    }> = [];
    for (const { input: i, decision } of decisions) {
      if (!decision.allowed) {
        failures.push({ input: i, decision });
      }
    }
    if (failures.length > 0) {
      throw new WorkspaceRejectedError(failures);
    }
  }

  // REVIEW-W11: respect the per-agent selection. The agent row's
  // `mcpServerIds` and `subagentDefinitionIds` are the user's explicit
  // pick from the NewAgentDialog tabs. Only rows referenced there get
  // materialised onto AgentOptions. Empty arrays mean "no MCP servers /
  // subagents for this agent" — the dialog default reflects that.
  const selectedMcpIds = new Set(agent.mcpServerIds);
  const selectedSubagentIds = new Set(agent.subagentDefinitionIds);

  const mcp: NonNullable<AgentOptions["mcpServers"]> = {};
  for (const server of mcpServers) {
    if (!selectedMcpIds.has(server.id)) continue;
    if (!server.enabled) continue;
    if (server.validationStatus !== "valid") continue;
    // shared/zod infers `type?: "stdio" | undefined`; the SDK's exported type
    // is `type?: "stdio"` (no explicit undefined). The runtime shapes match,
    // but exactOptionalPropertyTypes requires us to bridge with a cast.
    mcp[server.name] = server.config as McpServerConfig;
  }

  const agentsDefinitions: NonNullable<AgentOptions["agents"]> = {};
  for (const sub of subagents) {
    if (!selectedSubagentIds.has(sub.id)) continue;
    if (!sub.enabled) continue;
    // subagent.mcpServerIds is the subagent's own allowlist; we also
    // gate by the parent agent's selection so a subagent can't reach
    // into a server the agent didn't pick.
    const subagentMcp: string[] = sub.mcpServerIds.filter((id) =>
      mcpServers.some(
        (s) =>
          s.id === id &&
          selectedMcpIds.has(s.id) &&
          s.enabled &&
          s.validationStatus === "valid",
      ),
    );
    agentsDefinitions[sub.name] = {
      description: sub.description,
      prompt: sub.prompt,
      // SubagentModelOverride is `{ id } | null`. The SDK accepts
      // `ModelSelection | "inherit"`; omitting the field is equivalent
      // to "inherit", so we only set it when the user picked an
      // explicit override. F-004: translate to the SDK's literal so
      // override values picked from the harness UI don't get rejected.
      ...(sub.model !== null ? { model: { id: toSdkModelId(sub.model.id) } } : {}),
      ...(subagentMcp.length > 0 ? { mcpServers: subagentMcp } : {}),
    };
  }

  const options: AgentOptions = {
    apiKey,
    agentId: agent.id,
    name: agent.name,
    model: { id: toSdkModelId(agent.modelId) },
    ...(Object.keys(mcp).length > 0 ? { mcpServers: mcp } : {}),
    ...(Object.keys(agentsDefinitions).length > 0
      ? { agents: agentsDefinitions }
      : {}),
  };

  if (localCwd) {
    // REVIEW-S8: `if (localCwd)` narrows away the optional without a
    // cast — the previous `agent.mode === "local"` branch needed
    // `localCwd as ReadonlyArray<string>` because TS couldn't relate
    // the two branches.
    const cwdValue: string | string[] =
      localCwd.length === 1 ? localCwd[0]! : [...localCwd];
    const local: NonNullable<AgentOptions["local"]> = {};
    local.cwd = cwdValue;
    if (agent.settingSources && agent.settingSources.length > 0) {
      local.settingSources = [...agent.settingSources];
    }
    if (agent.sandboxEnabled !== null) {
      local.sandboxOptions = { enabled: agent.sandboxEnabled };
    }
    options.local = local;
  } else {
    // cloud
    if (agent.cloudOptions) {
      options.cloud = agent.cloudOptions as NonNullable<AgentOptions["cloud"]>;
    }
  }

  return options;
}

/**
 * Narrowing helper: returns the agent's cwd array if non-empty, else
 * throws `WorkspaceRejectedError` with a `(none)` placeholder. Keeps the
 * "local agents must have at least one cwd" invariant local to the call
 * site so future refactors of the surrounding guard can't quietly break
 * the downstream code that previously used `agent.cwd!`.
 */
function requireCwd(agent: AgentRow): ReadonlyArray<string> {
  if (!agent.cwd || agent.cwd.length === 0) {
    throw new WorkspaceRejectedError([
      {
        input: "(none)",
        decision: {
          allowed: false,
          normalizedPath: "",
          reason: "not_allowlisted",
        },
      },
    ]);
  }
  return agent.cwd;
}
