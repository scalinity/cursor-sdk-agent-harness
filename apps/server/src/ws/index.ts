// Phase 07 — WebSocket layer barrel.
//
// `run-bus` carries committed canonical events to subscribed sockets;
// `ws-plugin` is the Fastify route + frame router + heartbeat owner;
// `frame-builder` maps EventRow → ServerFrame with large-payload handling.

export { createRunBus, type RunBus, type RunBusListener } from "./run-bus.js";
export { wsPlugin, type WsPluginOptions } from "./ws-plugin.js";
export { buildServerFrame, buildLargePayloadUrl } from "./frame-builder.js";
