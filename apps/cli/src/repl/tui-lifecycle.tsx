import type { ReactElement } from "react";
import { render } from "ink";

const ENTER_ALT_SCREEN = "\u001b[?1049h\u001b[2J\u001b[?25l";
const EXIT_ALT_SCREEN = "\u001b[?25h\u001b[?1049l";

type SignalName = "SIGINT" | "SIGTERM" | "SIGHUP";

export async function renderFullscreenApp(node: ReactElement): Promise<void> {
  if (!process.stdout.isTTY) {
    const instance = render(node, { exitOnCtrlC: false, patchConsole: true });
    await instance.waitUntilExit();
    return;
  }

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.stdout.write(EXIT_ALT_SCREEN);
  };

  process.stdout.write(ENTER_ALT_SCREEN);
  const instance = render(node, { exitOnCtrlC: false, patchConsole: true, maxFps: 30 });
  const signals: SignalName[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const signalHandlers = new Map<SignalName, () => void>();

  for (const signal of signals) {
    const handler = () => {
      process.exitCode = signal === "SIGINT" ? 130 : 143;
      instance.unmount();
      restore();
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    await instance.waitUntilExit();
  } catch (error) {
    restore();
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    instance.cleanup();
    restore();
  }
}
