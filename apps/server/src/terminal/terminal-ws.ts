import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { RawData, WebSocket } from "ws";
import {
  MAX_TERMINAL_INPUT_CHARS,
  terminalClientFrameSchema,
  terminalViewportSchema,
  type TerminalClientFrame,
  type TerminalServerFrame,
  type TerminalViewport,
} from "@harness/shared";
import type { CsrfTokenizer } from "../security/csrf.js";
import { rawDataByteLength, rawDataToString } from "../ws/raw-data.js";
import { validateWsUpgrade } from "../ws/upgrade-guard.js";
import type { TerminalSession } from "./terminal-session.js";

export interface TerminalWsPluginOptions {
  csrf: CsrfTokenizer;
  allowedOrigin?: string;
  allowedOrigins?: ReadonlyArray<string>;
  session: TerminalSession;
}

const MAX_TERMINAL_CLIENT_FRAME_BYTES = MAX_TERMINAL_INPUT_CHARS * 4 + 1024;

/**
 * `/ws/terminal` — the embedded terminal's bidirectional byte channel.
 *
 * Separate from the run-event `/ws` route on purpose: terminal I/O is
 * ephemeral and never touches the persist-and-broadcast pipeline or `RunBus`.
 * The upgrade is gated by the same Origin + CSRF guard as `/ws`.
 */
const terminalWsPluginImpl: FastifyPluginAsync<TerminalWsPluginOptions> = async (
  app: FastifyInstance,
  opts: TerminalWsPluginOptions,
) => {
  app.get("/ws/terminal", { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    const reqLog = req.log;
    const upgradeError = validateWsUpgrade(req, opts);
    if (upgradeError) {
      reqLog.warn({ code: upgradeError.code }, "ws/terminal: upgrade rejected");
      // 1008 = policy violation (CSRF / origin).
      socket.close(1008, upgradeError.message);
      return;
    }

    const initialViewport = parseInitialViewport(req.url);

    const send = (frame: TerminalServerFrame): void => {
      if (socket.readyState !== socket.OPEN) return;
      try {
        socket.send(JSON.stringify(frame));
      } catch {
        // best-effort; close handler tears down
      }
    };

    let detach: (() => void) | null = null;
    let closed = false;
    let attached = false;
    const pendingInput: string[] = [];

    const handleFrame = (frame: TerminalClientFrame): void => {
      switch (frame.type) {
        case "input":
          if (!attached) {
            pendingInput.push(frame.data);
            return;
          }
          opts.session.write(frame.data);
          return;
        case "resize":
          opts.session.resize(frame.cols, frame.rows);
          return;
        default: {
          const _exhaustive: never = frame;
          void _exhaustive;
          return;
        }
      }
    };

    void opts.session
      .attach({ send }, initialViewport)
      .then((d) => {
        // The socket may have closed during the async spawn; detach at once.
        if (closed) {
          d();
          return;
        }
        detach = d;
        attached = true;
        for (const input of pendingInput.splice(0)) opts.session.write(input);
      })
      .catch((err: unknown) => {
        pendingInput.length = 0;
        reqLog.error({ err }, "ws/terminal: attach failed");
        send({ type: "error", message: "Failed to attach terminal session" });
      });

    socket.on("message", (data: RawData) => {
      if (rawDataByteLength(data) > MAX_TERMINAL_CLIENT_FRAME_BYTES) {
        send({ type: "error", message: "Frame exceeds terminal websocket size limit" });
        socket.close(1009, "terminal frame too large");
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(rawDataToString(data));
      } catch {
        send({ type: "error", message: "Frame is not valid JSON" });
        return;
      }
      const parsed = terminalClientFrameSchema.safeParse(raw);
      if (!parsed.success) {
        send({ type: "error", message: "Frame failed schema validation" });
        return;
      }
      handleFrame(parsed.data);
    });

    socket.on("close", () => {
      closed = true;
      detach?.();
    });

    socket.on("error", (err: Error) => {
      reqLog.warn({ err }, "ws/terminal: socket error");
      closed = true;
      detach?.();
    });
  });
};

function parseInitialViewport(url: string): TerminalViewport | undefined {
  const params = new URL(url, "http://localhost").searchParams;
  const parsed = terminalViewportSchema.safeParse({
    cols: parseTerminalDimension(params.get("cols")),
    rows: parseTerminalDimension(params.get("rows")),
  });
  return parsed.success ? parsed.data : undefined;
}

function parseTerminalDimension(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

export const terminalWsPlugin = fp(terminalWsPluginImpl, {
  name: "harness-terminal-ws",
  dependencies: ["@fastify/websocket"],
});
