import {
  DEFAULT_MODEL_ID,
  MODEL_LABELS,
  modelIdSchema,
  type AgentSummary,
} from "@harness/shared";

/**
 * Pure helper mapping an agent to a display label + title for its model.
 * Relocated from Composer (R17-S4) since the model pill became a `<Select>`
 * and the component no longer consumes this in render; it remains covered by
 * unit tests. The unknown-id branch is load-bearing — it must surface the
 * agent's real model id even when the harness MODEL_LABELS map lacks an entry,
 * so "looks wrong" prompts a MODEL_LABELS update instead of silent
 * misreporting.
 */
export function describeModel(
  activeAgent: AgentSummary | null,
): { modelLabel: string; modelTitle: string } {
  if (!activeAgent) {
    const label = MODEL_LABELS[DEFAULT_MODEL_ID];
    return {
      modelLabel: label,
      modelTitle: `Default model: ${label}. Models are configured per agent in the New Agent dialog.`,
    };
  }
  const parsed = modelIdSchema.safeParse(activeAgent.modelId);
  if (parsed.success) {
    const label = MODEL_LABELS[parsed.data];
    return {
      modelLabel: label,
      modelTitle: `Model: ${label} (set on agent ${activeAgent.name})`,
    };
  }
  return {
    modelLabel: `${activeAgent.modelId} (unknown)`,
    modelTitle: `Unknown model id "${activeAgent.modelId}" set on agent ${activeAgent.name}. Update the Orrery MODEL_LABELS map to render a friendly name.`,
  };
}
