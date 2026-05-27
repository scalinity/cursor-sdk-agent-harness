import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { serverFrameSchema, type ClientFrame, type ServerFrame } from "@harness/shared";
import type { CliStreamPort } from "../types.js";

export interface HarnessWsClientOptions {
  serverUrl: string;
  csrfToken: string;
  origin?: string;
  terminalStatusGraceMs?: number;
}

export class CliStreamError extends Error {
  readonly code: "STREAM_DISCONNECTED";

  constructor(message: string) {
    super(message);
    this.name = "CliStreamError";
    this.code = "STREAM_DISCONNECTED";
  }
}

export class HarnessWsClient implements CliStreamPort {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly origin: string;
  private readonly terminalStatusGraceMs: number;

  constructor(options: HarnessWsClientOptions) {
    this.url = buildWsUrl(options.serverUrl, options.csrfToken);
    this.origin = options.origin ?? "http://127.0.0.1:5173";
    this.terminalStatusGraceMs = options.terminalStatusGraceMs ?? 750;
  }

  async connect(onFrame: (frame: ServerFrame) => void): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url, { origin: this.origin });
      this.socket = socket;
      const rejectInitial = (error: Error) => reject(error);
      const rejectClosed = () => reject(new CliStreamError("WebSocket closed before the connection opened."));
      socket.once("open", () => {
        socket.off("error", rejectInitial);
        socket.off("close", rejectClosed);
        resolve();
      });
      socket.once("error", rejectInitial);
      socket.once("close", rejectClosed);
      socket.on("message", (data) => {
        const raw = typeof data === "string" ? data : data.toString("utf8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        const result = serverFrameSchema.safeParse(parsed);
        if (!result.success) return;
        const frame = result.data;
        if (frame.type === "heartbeat") {
          this.send({
            id: frameId("hb"),
            type: "heartbeat_ack",
            sent_at: new Date().toISOString(),
            server_heartbeat_id: frame.heartbeat_id,
          });
          return;
        }
        onFrame(frame);
      });
    });
  }

  async subscribeToRun(runId: string, onFrame: (frame: ServerFrame) => void): Promise<void> {
    let terminalFrameSeen = false;
    let terminalStatusSeen = false;
    let terminalStatusFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTerminalStatusFallback = () => {
      if (terminalStatusFallbackTimer) clearTimeout(terminalStatusFallbackTimer);
      terminalStatusFallbackTimer = null;
    };
    await this.connect((frame) => {
      onFrame(frame);
      if (isTerminalFrame(frame)) {
        terminalFrameSeen = true;
        clearTerminalStatusFallback();
        this.close();
        return;
      }
      if (isRunStatusTerminalFrame(frame) && !terminalStatusSeen) {
        terminalStatusSeen = true;
        terminalStatusFallbackTimer = setTimeout(() => {
          terminalFrameSeen = true;
          this.close();
        }, this.terminalStatusGraceMs);
      }
    });
    this.send({
      id: frameId("sub"),
      type: "subscribe_run",
      sent_at: new Date().toISOString(),
      run_id: runId,
      after_seq: 0,
      replay: { enabled: true, speed: "instant" },
    });
    await new Promise<void>((resolve, reject) => {
      const socket = this.socket;
      if (!socket) {
        reject(new CliStreamError("WebSocket closed before subscription started."));
        return;
      }
      const cleanup = () => {
        clearTerminalStatusFallback();
        socket.off("close", onClose);
        socket.off("error", onError);
      };
      const onClose = (code: number, reason: Buffer) => {
        cleanup();
        this.socket = null;
        if (terminalFrameSeen || terminalStatusSeen) {
          resolve();
          return;
        }
        const suffix = reason.length > 0 ? `: ${reason.toString("utf8")}` : "";
        reject(new CliStreamError(`WebSocket disconnected before the run finished (code ${code})${suffix}`));
      };
      const onError = (error: Error) => {
        cleanup();
        if (terminalFrameSeen || terminalStatusSeen) {
          this.socket = null;
          resolve();
          return;
        }
        reject(new CliStreamError(error.message));
      };
      socket.once("close", onClose);
      socket.once("error", onError);
    });
  }

  cancelRun(runId: string): boolean {
    const frame: ClientFrame = {
      id: frameId("cancel"),
      type: "cancel_run",
      sent_at: new Date().toISOString(),
      run_id: runId,
      reason: "user_cancelled",
    };
    return this.send(frame);
  }

  sendApproval(runId: string, requestId: string, decision: "approve" | "deny", reason?: string): void {
    const frame: ClientFrame = {
      id: frameId("approval"),
      type: "approval_response",
      sent_at: new Date().toISOString(),
      run_id: runId,
      request_id: requestId,
      decision,
      ...(reason !== undefined ? { reason } : {}),
    };
    this.send(frame);
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN) socket.close(1000, "done");
    else if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.CLOSING) socket.terminate();
  }

  private send(frame: ClientFrame): boolean {
    const socket = this.socket;
    if (!socket) return false;
    const serialized = JSON.stringify(frame);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(serialized);
      return true;
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.once("open", () => {
        if (this.socket === socket && socket.readyState === WebSocket.OPEN) socket.send(serialized);
      });
      return true;
    }
    return false;
  }
}

export function buildWsUrl(serverUrl: string, csrfToken: string): string {
  const url = new URL(serverUrl.replace(/\/$/, ""));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("csrf", csrfToken);
  return url.toString();
}

function frameId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function isTerminalFrame(frame: ServerFrame): boolean {
  return frame.type === "run.final_result" || frame.type === "run.interrupted";
}

const TERMINAL_RUN_STATUSES = new Set<string>(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

export function isRunStatusTerminalFrame(frame: ServerFrame): boolean {
  return frame.type === "sdk.status" && TERMINAL_RUN_STATUSES.has(frame.event.payload.status);
}
