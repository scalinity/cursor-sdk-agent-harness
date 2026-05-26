import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { describe, expect, it } from "vitest";
import { buildWsUrl, CliStreamError, HarnessWsClient, isRunStatusTerminalFrame, isTerminalFrame } from "../../src/client/ws.js";
import type { ServerFrame } from "@harness/shared";

const finalFrame = {
  id: "frame-final",
  type: "run.final_result",
  sent_at: "2026-05-25T18:00:01.000Z",
  event: {
    event_id: "00000000-0000-4000-8000-000000000011",
    schema_version: 1,
    seq: 2,
    agent_id: "agent-1",
    run_id: "run-1",
    occurred_at: "2026-05-25T18:00:01.000Z",
    received_at: "2026-05-25T18:00:01.000Z",
    sdk_type: "status",
    kind: "run.final_result",
    status: "FINISHED",
    payload: { duration_ms: 1000, usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: 0, reasoning_tokens: null, cost_usd_micros: null, usage_source: "unavailable" } },
  },
} satisfies ServerFrame;

const statusFinishedFrame = {
  id: "frame-status",
  type: "sdk.status",
  sent_at: "2026-05-25T18:00:00.500Z",
  event: {
    event_id: "00000000-0000-4000-8000-000000000010",
    schema_version: 1,
    seq: 1,
    agent_id: "agent-1",
    run_id: "run-1",
    occurred_at: "2026-05-25T18:00:00.500Z",
    received_at: "2026-05-25T18:00:00.500Z",
    sdk_type: "status",
    kind: "status.changed",
    status: "FINISHED",
    payload: { status: "FINISHED" },
  },
} satisfies ServerFrame;

async function createWsServer() {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    serverUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

describe("HarnessWsClient contracts", () => {
  it("builds the run websocket URL with the csrf token", () => {
    expect(buildWsUrl("http://127.0.0.1:4783", "csrf-token")).toBe("ws://127.0.0.1:4783/ws?csrf=csrf-token");
    expect(buildWsUrl("https://harness.example", "csrf-token")).toBe("wss://harness.example/ws?csrf=csrf-token");
  });

  it("uses the configured origin and resolves when a terminal frame arrives", async () => {
    const { server, serverUrl, close } = await createWsServer();
    let origin: string | undefined;
    server.once("connection", (socket, request) => {
      origin = request.headers.origin;
      socket.once("message", () => socket.send(JSON.stringify(finalFrame)));
    });

    const client = new HarnessWsClient({ serverUrl, csrfToken: "csrf-token", origin: "http://cli.test" });
    await client.subscribeToRun("run-1", () => undefined);
    await close();

    expect(origin).toBe("http://cli.test");
  });

  it("keeps the subscription open for sdk.status until the durable final frame arrives", async () => {
    const { server, serverUrl, close } = await createWsServer();
    const received: string[] = [];
    server.once("connection", (socket) => {
      socket.once("message", () => {
        socket.send(JSON.stringify(statusFinishedFrame));
        setTimeout(() => socket.send(JSON.stringify(finalFrame)), 5);
      });
    });

    const client = new HarnessWsClient({ serverUrl, csrfToken: "csrf-token" });
    await client.subscribeToRun("run-1", (frame) => received.push(frame.type));
    await close();

    expect(received).toEqual(["sdk.status", "run.final_result"]);
  });

  it("distinguishes durable terminal frames from logical terminal status frames", () => {
    expect(isTerminalFrame(statusFinishedFrame)).toBe(false);
    expect(isRunStatusTerminalFrame(statusFinishedFrame)).toBe(true);
    expect(isTerminalFrame(finalFrame)).toBe(true);
    expect(isRunStatusTerminalFrame(finalFrame)).toBe(false);
  });

  it("resolves after a terminal sdk.status when no durable final frame arrives", async () => {
    const { server, serverUrl, close } = await createWsServer();
    const received: string[] = [];
    server.once("connection", (socket) => {
      socket.once("message", () => {
        socket.send(JSON.stringify(statusFinishedFrame));
      });
    });

    const client = new HarnessWsClient({ serverUrl, csrfToken: "csrf-token", terminalStatusGraceMs: 5 });
    await client.subscribeToRun("run-1", (frame) => received.push(frame.type));
    await close();

    expect(received).toEqual(["sdk.status"]);
  });

  it("rejects when the socket closes before a terminal frame", async () => {
    const { server, serverUrl, close } = await createWsServer();
    server.once("connection", (socket) => {
      socket.once("message", () => socket.close(1011, "server dropped"));
    });

    const client = new HarnessWsClient({ serverUrl, csrfToken: "csrf-token" });
    await expect(client.subscribeToRun("run-1", () => undefined)).rejects.toBeInstanceOf(CliStreamError);
    await close();
  });
});
