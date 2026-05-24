import type { ITheme } from "@xterm/xterm";

/**
 * Maps the embedded-terminal design tokens (`--term-*` in `tokens.css`) onto
 * xterm's theme object. Colors are never hardcoded here — each entry resolves
 * a CSS variable at runtime, so the palette stays token-driven and changes to
 * `tokens.css` flow through automatically.
 */
const THEME_VARS: Record<keyof ThemeColors, string> = {
  background: "--term-background",
  foreground: "--term-foreground",
  cursor: "--term-cursor",
  cursorAccent: "--term-background",
  selectionBackground: "--term-selection",
  black: "--term-black",
  red: "--term-red",
  green: "--term-green",
  yellow: "--term-yellow",
  blue: "--term-blue",
  magenta: "--term-magenta",
  cyan: "--term-cyan",
  white: "--term-white",
  brightBlack: "--term-bright-black",
  brightRed: "--term-bright-red",
  brightGreen: "--term-bright-green",
  brightYellow: "--term-bright-yellow",
  brightBlue: "--term-bright-blue",
  brightMagenta: "--term-bright-magenta",
  brightCyan: "--term-bright-cyan",
  brightWhite: "--term-bright-white",
};

type ThemeColors = Pick<
  ITheme,
  | "background"
  | "foreground"
  | "cursor"
  | "cursorAccent"
  | "selectionBackground"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite"
>;

export interface TerminalAppearance {
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
}

/**
 * Resolve every `--term-*` token (and the mono font tokens) into concrete
 * colors xterm can parse. `probeParent` must be attached to the document so
 * `var()` resolves against `:root`. Colors are normalised through a canvas so
 * xterm always receives a `#rrggbb`/`rgba()` string even if the token is
 * authored in OKLCH.
 */
export function readTerminalAppearance(probeParent: HTMLElement): TerminalAppearance {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probeParent.appendChild(probe);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const normalize = (color: string): string => {
    if (!ctx) return color;
    ctx.fillStyle = "#000000";
    ctx.fillStyle = color;
    return ctx.fillStyle;
  };

  const resolve = (varName: string): string => {
    probe.style.color = "";
    probe.style.color = `var(${varName})`;
    const resolved = getComputedStyle(probe).color;
    return normalize(resolved);
  };

  const theme: Record<string, string> = {};
  for (const key of Object.keys(THEME_VARS) as Array<keyof ThemeColors>) {
    theme[key] = resolve(THEME_VARS[key]);
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const fontFamily =
    rootStyle.getPropertyValue("--font-family-mono").trim() || "ui-monospace, monospace";
  const fontSize = Number.parseInt(rootStyle.getPropertyValue("--font-size-base"), 10) || 13;

  probe.remove();
  return { theme: theme as ITheme, fontFamily, fontSize };
}
