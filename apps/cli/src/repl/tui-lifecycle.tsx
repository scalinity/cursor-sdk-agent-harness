import type { ReactElement } from "react";
import { render } from "ink";

const ENTER_ALT_SCREEN = "[?1049h[2J[?25l";
const EXIT_ALT_SCREEN = "[?25h[?1049l";

type SignalName = "SIGINT" | "SIGTERM" | "SIGHUP";

export interface FullscreenRenderOptions {
  onExit?: () => void;
}

export interface FullscreenSession {
  /** Swap the rendered tree in place (e.g. boot screen → live app). */
  rerender: (node: ReactElement) => void;
  /** Resolves when the app unmounts (user exit, Ctrl+C inside Ink, or signal). */
  waitUntilExit: () => Promise<void>;
  /** Restore the terminal, unmount Ink, and detach signal handlers. Idempotent. */
  dispose: () => void;
}

/**
 * Enters the alternate screen, mounts Ink, and installs signal teardown — then
 * hands back a session the caller drives. Splitting mount from "await exit" lets
 * the entrypoint paint a boot screen immediately and `rerender` the live app
 * once async startup (embedded server, agent resolution) completes.
 */
export function mountFullscreen(node: ReactElement, options: FullscreenRenderOptions = {}): FullscreenSession {
  if (!process.stdout.isTTY) {
    const instance = render(node, { exitOnCtrlC: false, patchConsole: true });
    let disposed = false;
    return {
      rerender: (next) => instance.rerender(next),
      waitUntilExit: () => instance.waitUntilExit(),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        instance.cleanup();
      },
    };
  }

  let instance: ReturnType<typeof render> | null = null;
  let restored = false;
  let unmounted = false;
  let disposed = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.stdout.write(EXIT_ALT_SCREEN);
  };
  const unmount = () => {
    if (unmounted) return;
    unmounted = true;
    instance?.unmount();
  };
  const cleanupApp = () => {
    try {
      options.onExit?.();
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
  };

  const signals: SignalName[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const signalHandlers = new Map<SignalName, () => void>();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    unmount();
    instance?.cleanup();
    restore();
  };

  try {
    process.stdout.write(ENTER_ALT_SCREEN);
    instance = render(node, { exitOnCtrlC: false, patchConsole: true, maxFps: 30 });
    for (const signal of signals) {
      const handler = () => {
        process.exitCode = signal === "SIGINT" ? 130 : 143;
        cleanupApp();
        unmount();
        restore();
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  } catch (error) {
    cleanupApp();
    restore();
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }

  return {
    rerender: (next) => {
      if (instance) instance.rerender(next);
    },
    waitUntilExit: () => (instance ? instance.waitUntilExit() : Promise.resolve()),
    dispose,
  };
}

export async function renderFullscreenApp(node: ReactElement, options: FullscreenRenderOptions = {}): Promise<void> {
  const session = mountFullscreen(node, options);
  try {
    await session.waitUntilExit();
  } finally {
    session.dispose();
  }
}
