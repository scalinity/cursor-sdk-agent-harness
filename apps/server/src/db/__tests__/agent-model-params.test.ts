import { afterEach, describe, expect, it } from "vitest";
import { openTestDb } from "./helpers.js";
import { createRepositories } from "../repositories/index.js";
import type { DbClient } from "../client.js";

let client: DbClient | null = null;

afterEach(() => {
  if (client) {
    client.close();
    client = null;
  }
});

function setup() {
  client = openTestDb({ skipSeed: true });
  return createRepositories(client.raw);
}

describe("agents.model_params_json persistence", () => {
  it("round-trips modelParams on create and getById", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Effort Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      modelParams: [{ id: "thinking", value: "high" }],
      cwd: ["/tmp/ws"],
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    expect(agent.modelParams).toEqual([{ id: "thinking", value: "high" }]);
    expect(repos.agents.getById(agent.id)?.modelParams).toEqual([
      { id: "thinking", value: "high" },
    ]);
  });

  it("defaults modelParams to null when omitted", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Plain Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    expect(agent.modelParams).toBeNull();
  });

  it("setModelParams updates and clears the persisted params", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Effort Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    repos.agents.setModelParams(agent.id, [{ id: "thinking", value: "low" }]);
    expect(repos.agents.getById(agent.id)?.modelParams).toEqual([
      { id: "thinking", value: "low" },
    ]);
    repos.agents.setModelParams(agent.id, null);
    expect(repos.agents.getById(agent.id)?.modelParams).toBeNull();
  });

  it("rejects malformed model_params_json at write time (json_valid CHECK)", () => {
    const repos = setup();
    const agent = repos.agents.create({
      name: "Effort Agent",
      status: "active",
      mode: "local",
      modelId: "composer-2-5-fast",
      mcpServerIds: [],
      subagentDefinitionIds: [],
    });
    expect(() =>
      client!.raw
        .prepare("UPDATE agents SET model_params_json = ? WHERE id = ?")
        .run("{not valid json", agent.id),
    ).toThrow(/CHECK constraint failed/i);
  });
});
