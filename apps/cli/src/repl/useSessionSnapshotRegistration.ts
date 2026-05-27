import { useEffect, type MutableRefObject } from "react";
import { createSessionSnapshot, type CliSessionSnapshot } from "../session.js";
import type { CliAgentSummary, CliMode } from "../types.js";
import type { StreamBuffer } from "./StreamView.js";
import type { SessionCostState, SessionTokenState } from "./StatusBar.js";

export interface ReplSessionSnapshotState {
  workspace: string;
  agent: CliAgentSummary;
  mode: CliMode;
  modelId: string;
  sessionCost: SessionCostState;
  sessionTokens: SessionTokenState;
  buffer: StreamBuffer;
  scrollOffset: number;
}

export function useSessionSnapshotRegistration(
  onRegisterSessionSnapshot: ((getter: () => CliSessionSnapshot) => void) | undefined,
  sessionStateRef: MutableRefObject<ReplSessionSnapshotState>,
): void {
  useEffect(() => {
    onRegisterSessionSnapshot?.(() => createSessionSnapshot(sessionStateRef.current));
  }, [onRegisterSessionSnapshot, sessionStateRef]);
}
