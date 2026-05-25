import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { serverFrameSchema, type ClientFrame, type ServerFrame } from "@harness/shared";
import type { CliStreamPort } from "../types.js";

export interface HarnessWsClientOptions {
  serverUrl: string;
  csrfToken: string;
}

export class HarnessWsClient implements CliStreamPort {
  private socket: WebSocket | null = null;
  private readonly url: string;

  constructor(options: HarnessWsClientOptions) {
    this.url = buildWsUrl(options.serverUrl, options.csrfToken);
  }

  async connect(onFrame: (frame: ServerFrame) => void): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url, { origin: "http://127.0.0.1:5173" });
      this.socket = socket;
      socket.once("open", () => resolve());
      socket.once("error", (error) => reject(error));
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
    await this.connect((frame) => {
      onFrame(frame);
      if (isTerminalFrame(frame)) this.close();
    });
    this.send({
      id: frameId("sub"),
      type: "subscribe_run",
      sent_at: new Date().toISOString(),
      run_id: runId,
      after_seq: 0,
      replay: { enabled: true, speed: "instant" },
    });
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (!this.socket || this.socket.readyState === WebSocket.CLOSED || this.socket.readyState === WebSocket.CLOSING) {
          clearInterval(poll);
          resolve();
        }
      }, 25);
    });
  }

  cancelRun(runId: string): void {
    this.send({
      id: frameId("cancel"),
      type: "cancel_run",
      sent_at: new Date().toISOString(),
      run_id: runId,
      reason: "user_cancelled",
    });
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
    if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, "done");
  }

  private send(frame: ClientFrame): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }
}

function buildWsUrl(serverUrl: string, csrfToken: string): string {
  const url = new URL(serverUrl.replace(/\/$/, ""));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("csrf", csrfToken);
  return url.toString();
}

function frameId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function isTerminalFrame(frame: ServerFrame): boolean {
  if (frame.type === "run.final_result" || frame.type === "run.interrupted") return true;
  return frame.type === "sdk.status" && ["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(frame.event.payload.status);
}
