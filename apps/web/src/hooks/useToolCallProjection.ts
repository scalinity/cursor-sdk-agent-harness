import { useRunStore } from "../state/run-store.js";
import type { ToolCallLaneGroup, ToolCallProjection } from "../lib/tool-call-projection.js";

const EMPTY_CALLS: ToolCallProjection[] = [];
const EMPTY_GROUPS: ToolCallLaneGroup[] = [];

export function useToolCallProjection(runId: string | null) {
  const calls = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.toolCallProjections ?? EMPTY_CALLS) : EMPTY_CALLS,
  );
  const groups = useRunStore((s) =>
    runId ? (s.eventsByRunId[runId]?.toolCallGroups ?? EMPTY_GROUPS) : EMPTY_GROUPS,
  );
  return { calls, groups };
}
