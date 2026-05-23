import { useToolCallProjection } from "../../hooks/useToolCallProjection.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { StreamingSurfaceBoundary } from "./StreamingSurfaceBoundary.js";

export interface ToolCallLaneProps {
  runId: string | null;
}

export function ToolCallLane({ runId }: ToolCallLaneProps) {
  const { calls, groups } = useToolCallProjection(runId);
  if (!runId || calls.length === 0) return null;
  const byId = new Map(calls.map((call) => [call.callId, call]));

  return (
    <div className="tool-call-stack">
      {groups.map((group) => {
        if (group.type === "card") {
          const call = byId.get(group.callId);
          if (!call) return null;
          return (
            <StreamingSurfaceBoundary key={call.callId} surface={`tool-card-${call.callId}`}>
              <ToolCallCard call={call} runId={runId} />
            </StreamingSurfaceBoundary>
          );
        }
        return (
          <div key={group.callIds.join("-")} className="tool-call-lane">
            {group.callIds.map((callId) => {
              const call = byId.get(callId);
              if (!call) return null;
              return (
                <StreamingSurfaceBoundary key={call.callId} surface={`tool-card-${call.callId}`}>
                  <ToolCallCard call={call} runId={runId} />
                </StreamingSurfaceBoundary>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
