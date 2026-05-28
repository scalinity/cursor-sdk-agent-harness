import chalk from "chalk";
import { createTuiTheme, type TuiTheme } from "../repl/theme.js";

/**
 * Named content-styling tokens for the streaming surface. Every chalk call in
 * the render layer goes through one of these so colors live in exactly one
 * place (sourced from the theme palette). Tier 3 recolors by editing the theme
 * + this factory, not the call-sites. In NO_COLOR mode every token is identity.
 */
export interface Styles {
  brand(s: string): string;
  user(s: string): string;
  tool(s: string): string;
  toolResult(s: string): string;
  glyphOk(s: string): string;
  glyphErr(s: string): string;
  glyphRun(s: string): string;
  thinking(s: string): string;
  system(s: string): string;
  error(s: string): string;
  approval(s: string): string;
  muted(s: string): string;
  bold(s: string): string;
  italic(s: string): string;
  code(s: string): string;
  link(s: string): string;
  url(s: string): string;
  quote(s: string): string;
  diffAdd(s: string): string;
  diffDel(s: string): string;
  diffMeta(s: string): string;
  diffContext(s: string): string;
  frame(s: string): string;
  match(s: string): string;
  subagentName(s: string): string;
}

export function createStyles(theme: TuiTheme = createTuiTheme()): Styles {
  const identity = (s: string): string => s;
  if (theme.noColor) {
    return {
      brand: identity, user: identity, tool: identity, toolResult: identity,
      glyphOk: identity, glyphErr: identity, glyphRun: identity, thinking: identity,
      system: identity, error: identity, approval: identity, muted: identity,
      bold: identity, italic: identity, code: identity, link: identity, url: identity,
      quote: identity, diffAdd: identity, diffDel: identity, diffMeta: identity,
      diffContext: identity, frame: identity, match: identity, subagentName: identity,
    };
  }
  const fallback = createTuiTheme({});
  const color = (key: keyof TuiTheme): string => {
    const value = theme[key] ?? fallback[key];
    if (typeof value !== "string") throw new Error(`Missing TUI theme color: ${String(key)}`);
    return value;
  };
  const state = theme.state ?? fallback.state;
  if (state === undefined) throw new Error("Missing TUI state color group");
  const c = {
    text: color("text"),
    muted: color("muted"),
    brand: color("brand"),
    code: color("code"),
  };
  return {
    brand: (s) => chalk.hex(c.brand)(s),
    user: (s) => chalk.hex(c.text)(s),
    tool: (s) => chalk.hex(c.muted)(s),
    toolResult: (s) => chalk.hex(c.muted).dim(s),
    glyphOk: (s) => chalk.hex(state.success)(s),
    glyphErr: (s) => chalk.hex(state.error)(s),
    glyphRun: (s) => chalk.hex(state.running)(s),
    thinking: (s) => chalk.hex(c.muted).italic(s),
    system: (s) => chalk.hex(c.text)(s),
    error: (s) => chalk.hex(state.error)(s),
    approval: (s) => chalk.hex(state.running)(s),
    muted: (s) => chalk.hex(c.muted)(s),
    bold: (s) => chalk.bold(s),
    italic: (s) => chalk.italic(s),
    code: (s) => chalk.hex(c.code).inverse(s),
    link: (s) => chalk.underline(s),
    url: (s) => chalk.hex(c.muted)(s),
    quote: (s) => chalk.hex(c.muted)(s),
    diffAdd: (s) => chalk.hex(state.success)(s),
    diffDel: (s) => chalk.hex(state.error)(s),
    diffMeta: (s) => chalk.hex(c.text)(s),
    diffContext: (s) => chalk.hex(c.muted)(s),
    frame: (s) => chalk.hex(c.muted)(s),
    match: (s) => chalk.inverse(s),
    subagentName: (s) => chalk.hex(c.text).bold(s),
  };
}

export const styles = createStyles();
