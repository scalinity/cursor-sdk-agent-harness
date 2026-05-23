import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface WindowState {
  x: number | undefined;
  y: number | undefined;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULT_STATE: WindowState = {
  x: undefined,
  y: undefined,
  width: 1440,
  height: 900,
  maximized: false,
};

function statePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

export function loadWindowState(): WindowState {
  try {
    const raw = readFileSync(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    return {
      x: typeof parsed.x === "number" ? parsed.x : undefined,
      y: typeof parsed.y === "number" ? parsed.y : undefined,
      width: typeof parsed.width === "number" ? Math.max(1280, parsed.width) : DEFAULT_STATE.width,
      height: typeof parsed.height === "number" ? Math.max(800, parsed.height) : DEFAULT_STATE.height,
      maximized: parsed.maximized === true,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

let writeTimer: NodeJS.Timeout | null = null;
export function saveWindowState(state: WindowState): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      const p = statePath();
      if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(state, null, 2));
    } catch {
      // best-effort
    }
  }, 500);
}
