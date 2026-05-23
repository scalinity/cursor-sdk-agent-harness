import type { ModelSelection } from "@cursor/sdk";
import type {
  AgentOptions,
  Run,
  SDKAgent,
  SdkAdapter,
} from "./sdk-adapter.js";

/**
 * Synthetic SDK Run handle used by integration tests. Yields a configurable
 * sequence of stream events, optionally fires `onDelta`s during the stream,
 * and lets the test drive `wait()` and `cancel()` deterministically.
 *
 * The harness's runtime treats this like a real `Run` — same `supports()`,
 * same `stream()`, same `wait()`. Tests can build a multi-event happy path
 * or a cancel-mid-stream path without ever touching `@cursor/sdk`'s
 * connectrpc / sqlite plumbing.
 */
export interface StubRunInit {
  runId: string;
  agentId: string;
  events?: ReadonlyArray<unknown>;
  finalResult?: {
    status: "finished" | "error" | "cancelled";
    result?: string;
    durationMs?: number;
  };
  /** Per-stream delta events to fire BEFORE each yielded SDK message. */
  deltasBeforeEach?: ReadonlyArray<unknown>;
  /**
   * Delta events to fire ONCE before the first yielded SDK message, modelling
   * a single end-of-stream turn-ended event in a one-turn run.
   */
  deltasOnce?: ReadonlyArray<unknown>;
  supportsCancel?: boolean;
}

export class StubRun implements Run {
  readonly id: string;
  readonly agentId: string;
  readonly result?: string;
  readonly model?: ModelSelection;
  readonly durationMs?: number;

  private cancelled = false;
  private streamConsumed = false;

  constructor(
    init: StubRunInit,
    private readonly onDelta?: (args: { update: unknown }) => void | Promise<void>,
  ) {
    this.id = init.runId;
    this.agentId = init.agentId;
    if (init.finalResult?.result !== undefined) {
      this.result = init.finalResult.result;
    }
    if (init.finalResult?.durationMs !== undefined) {
      this.durationMs = init.finalResult.durationMs;
    }
    this._supportsCancel = init.supportsCancel ?? true;
    this._events = init.events ?? [];
    this._deltas = init.deltasBeforeEach ?? [];
    this._deltasOnce = init.deltasOnce ?? [];
    this._finalStatus = init.finalResult?.status ?? "finished";
  }

  private readonly _supportsCancel: boolean;
  private readonly _events: ReadonlyArray<unknown>;
  private readonly _deltas: ReadonlyArray<unknown>;
  private readonly _deltasOnce: ReadonlyArray<unknown>;
  private readonly _finalStatus: "finished" | "error" | "cancelled";

  supports(op: "stream" | "wait" | "cancel" | "conversation"): boolean {
    if (op === "cancel") return this._supportsCancel;
    return op === "stream" || op === "wait";
  }
  unsupportedReason(op: "stream" | "wait" | "cancel" | "conversation"): string | undefined {
    if (op === "cancel" && !this._supportsCancel) {
      return "stub: cancel disabled";
    }
    return undefined;
  }

  async *stream(): AsyncGenerator<never, void> {
    this.streamConsumed = true;
    // Fire one-shot deltas before the stream begins.
    for (const delta of this._deltasOnce) {
      if (this.onDelta) await this.onDelta({ update: delta });
    }
    for (const event of this._events) {
      if (this.cancelled) break;
      // Fire any deltas before each event — the harness's RunController
      // observes turn-ended deltas off onDelta, not the stream itself.
      for (const delta of this._deltas) {
        if (this.onDelta) await this.onDelta({ update: delta });
      }
      yield event as never;
    }
  }

  conversation(): Promise<never[]> {
    return Promise.resolve([]);
  }

  async wait(): Promise<{
    id: string;
    status: "finished" | "error" | "cancelled";
    result?: string;
    durationMs?: number;
  }> {
    // Mirror real SDK: don't resolve wait until the stream has been drained.
    while (!this.streamConsumed && !this.cancelled) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return {
      id: this.id,
      status: this.cancelled ? "cancelled" : this._finalStatus,
      ...(this.result !== undefined ? { result: this.result } : {}),
      ...(this.durationMs !== undefined ? { durationMs: this.durationMs } : {}),
    };
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
  }

  get status(): "running" | "finished" | "error" | "cancelled" {
    if (this.cancelled) return "cancelled";
    if (this.streamConsumed) return this._finalStatus;
    return "running";
  }

  onDidChangeStatus(): () => void {
    return () => {
      // no-op
    };
  }
}

export class StubSDKAgent implements SDKAgent {
  readonly model: undefined;
  constructor(readonly agentId: string) {}
  async send(): Promise<Run> {
    throw new Error("StubSDKAgent.send invoked directly; use createStubSdkAdapter");
  }
  close(): void {
    // no-op
  }
  async reload(): Promise<void> {
    // no-op
  }
  async [Symbol.asyncDispose](): Promise<void> {
    // no-op
  }
  async listArtifacts(): Promise<never[]> {
    return [];
  }
  async downloadArtifact(): Promise<Buffer> {
    return Buffer.alloc(0);
  }
}

export interface StubSdkAdapterOptions {
  /**
   * Hook invoked by `createAgent`. The test can throw here to simulate
   * SDK_CREATE_FAILED; otherwise the agentId in the supplied options is
   * preserved on the returned `StubSDKAgent`.
   */
  onCreate?: (options: AgentOptions) => void | Promise<void>;
  /**
   * Hook invoked by `send`. Receives the prompt and produces a `StubRun`
   * configuration. Default produces a finished run with no events.
   */
  onSend?: (input: {
    agent: StubSDKAgent;
    prompt: string;
    onDelta?: (args: { update: unknown }) => void | Promise<void>;
    idempotencyKey?: string;
  }) => StubRunInit | Promise<StubRunInit>;
}

export function createStubSdkAdapter(opts: StubSdkAdapterOptions = {}): SdkAdapter {
  return {
    async createAgent(options) {
      if (opts.onCreate) await opts.onCreate(options);
      return new StubSDKAgent(options.agentId ?? `stub-${Math.random().toString(36).slice(2, 10)}`);
    },
    async resumeAgent(agentId) {
      return new StubSDKAgent(agentId);
    },
    async send(agent, prompt, sendOptions) {
      const init = opts.onSend
        ? await opts.onSend({
            agent: agent as StubSDKAgent,
            prompt,
            ...(sendOptions.onDelta !== undefined ? { onDelta: sendOptions.onDelta } : {}),
            ...(sendOptions.idempotencyKey !== undefined
              ? { idempotencyKey: sendOptions.idempotencyKey }
              : {}),
          })
        : {
            runId: sendOptions.idempotencyKey ?? "stub-run",
            agentId: agent.agentId,
            events: [],
            finalResult: { status: "finished" as const },
          };
      return new StubRun(init, sendOptions.onDelta);
    },
  };
}
