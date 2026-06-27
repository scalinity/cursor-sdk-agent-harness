export const MIN_COLUMNS = 60;
export const MIN_ROWS = 16;

export interface TuiStateColors {
  ready: string;
  running: string;
  success: string;
  error: string;
}

export interface TuiTheme {
  noColor: boolean;
  background?: string;
  panel?: string;
  panelSoft?: string;
  border?: string;
  text?: string;
  muted?: string;
  brand?: string;
  code?: string;
  state?: TuiStateColors;
}

export function createTuiTheme(env: NodeJS.ProcessEnv = process.env): TuiTheme {
  const noColor = env.NO_COLOR !== undefined || env.FORCE_COLOR === "0" || env.TERM === "dumb";
  if (noColor) return { noColor };
  return {
    noColor,
    background: "",
    panel: "",
    panelSoft: "",
    border: "#66717f",
    text: "#eef2f7",
    muted: "#9aa3ad",
    // ASSUMPTION: brand is intentionally warm vermillion and used only for brand identity surfaces.
    brand: "#E04E1F",
    code: "#7dd7ff",
    state: {
      ready: "#95d475",
      running: "#f2c94c",
      success: "#95d475",
      error: "#ff7a8a",
    },
  };
}

export function statusColor(theme: TuiTheme, status: "ready" | "connecting" | "connected" | "reconnecting" | "disconnected"): string | undefined {
  if (theme.noColor) return undefined;
  const state = theme.state;
  if (status === "connected") return state?.success;
  if (status === "connecting" || status === "reconnecting") return state?.running;
  if (status === "disconnected") return state?.error;
  return state?.ready;
}

export function fg(color: string | undefined): { color?: string } {
  return color ? { color } : {};
}

export function bg(color: string | undefined): { backgroundColor?: string } {
  return color ? { backgroundColor: color } : {};
}

export function border(color: string | undefined): { borderColor?: string } {
  return color ? { borderColor: color } : {};
}

export function truncateMiddle(input: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleLength(input) <= maxWidth) return input;
  if (maxWidth <= 1) return "…";
  const headWidth = Math.ceil((maxWidth - 1) / 2);
  const tailWidth = Math.floor((maxWidth - 1) / 2);
  return `${input.slice(0, headWidth)}…${input.slice(Math.max(0, input.length - tailWidth))}`;
}

export function stripAnsi(input: string): string {
  const escape = String.fromCharCode(27);
  return input.replace(new RegExp(`${escape}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");
}

export function visibleLength(input: string): number {
  return stripAnsi(input).length;
}

export function hardWrapText(input: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const output: string[] = [];
  for (const originalLine of input.split("\n")) {
    const line = visibleLength(originalLine) > safeWidth ? stripAnsi(originalLine) : originalLine;
    if (line.length === 0) {
      output.push("");
      continue;
    }
    let remaining = line;
    while (visibleLength(remaining) > safeWidth) {
      const plain = stripAnsi(remaining);
      let breakAt = plain.lastIndexOf(" ", safeWidth);
      if (breakAt < Math.floor(safeWidth * 0.4)) breakAt = safeWidth;
      output.push(plain.slice(0, breakAt));
      remaining = plain.slice(breakAt).trimStart();
    }
    output.push(remaining);
  }
  return output;
}
