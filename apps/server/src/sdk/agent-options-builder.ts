import type { AgentOptions, McpServerConfig } from "@cursor/sdk";
import type {
  AgentRow,
  McpServerRow,
  SubagentDefinitionRow,
} from "@harness/shared";
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

  if (agent.mode === "local") {
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
    const decisions = await Promise.all(
      agent.cwd.map(async (candidate) => ({
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

  const mcp: NonNullable<AgentOptions["mcpServers"]> = {};
  for (const server of mcpServers) {
    if (!server.enabled) continue;
    if (server.validationStatus !== "valid") continue;
    // shared/zod infers `type?: "stdio" | undefined`; the SDK's exported type
    // is `type?: "stdio"` (no explicit undefined). The runtime shapes match,
    // but exactOptionalPropertyTypes requires us to bridge with a cast.
    mcp[server.name] = server.config as McpServerConfig;
  }

  const agentsDefinitions: NonNullable<AgentOptions["agents"]> = {};
  for (const sub of subagents) {
    if (!sub.enabled) continue;
    const subagentMcp: string[] = sub.mcpServerIds.filter((id) =>
      mcpServers.some(
        (s) => s.id === id && s.enabled && s.validationStatus === "valid",
      ),
    );
    agentsDefinitions[sub.name] = {
      description: sub.description,
      prompt: sub.prompt,
      // SubagentModel in the harness is always `{ id }`; the SDK accepts
      // ModelSelection | "inherit". We persist `{ id }` so it maps 1:1.
      model: sub.model,
      ...(subagentMcp.length > 0 ? { mcpServers: subagentMcp } : {}),
    };
  }

  const options: AgentOptions = {
    apiKey,
    agentId: agent.id,
    name: agent.name,
    model: { id: agent.modelId },
    ...(Object.keys(mcp).length > 0 ? { mcpServers: mcp } : {}),
    ...(Object.keys(agentsDefinitions).length > 0
      ? { agents: agentsDefinitions }
      : {}),
  };

  if (agent.mode === "local") {
    // cwd existence guaranteed above
    const cwdArray = agent.cwd!;
    const cwdValue: string | string[] | undefined =
      cwdArray.length === 1 ? cwdArray[0] : cwdArray;
    const local: NonNullable<AgentOptions["local"]> = {};
    if (cwdValue !== undefined) local.cwd = cwdValue;
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
