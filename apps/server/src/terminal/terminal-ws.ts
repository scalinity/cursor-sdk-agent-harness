import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { RawData, WebSocket } from "ws";
import {
  terminalClientFrameSchema,
  type TerminalServerFrame,
} from "@harness/shared";
import type { CsrfTokenizer } from "../security/csrf.js";
import { rawDataToString } from "../ws/raw-data.js";
import { validateWsUpgrade } from "../ws/upgrade-guard.js";
import type { TerminalSession } from "./terminal-session.js";

export interface TerminalWsPluginOptions {
  csrf: CsrfTokenizer;
  allowedOrigin?: string;
  allowedOrigins?: ReadonlyArray<string>;
  session: TerminalSession;
}

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
    void opts.session
      .attach({ send })
      .then((d) => {
        // The socket may have closed during the async spawn; detach at once.
        if (closed) {
          d();
          return;
        }
        detach = d;
      })
      .catch((err: unknown) => {
        reqLog.error({ err }, "ws/terminal: attach failed");
        send({ type: "error", message: "Failed to attach terminal session" });
      });

    socket.on("message", (data: RawData) => {
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
      const frame = parsed.data;
      switch (frame.type) {
        case "input":
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

export const terminalWsPlugin = fp(terminalWsPluginImpl, {
  name: "harness-terminal-ws",
  dependencies: ["@fastify/websocket"],
});
