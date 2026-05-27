import chalk from "chalk";
import { createTuiTheme, type TuiTheme } from "../repl/theme.js";

/**
 * Named content-styling tokens for the streaming surface. Every chalk call in
 * the render layer goes through one of these so colors live in exactly one
 * place (sourced from the theme palette). Tier 3 recolors by editing the theme
 * + this factory, not the call-sites. In NO_COLOR mode every token is identity.
 */
export interface Styles {
  accent(s: string): string;
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
}

export function createStyles(theme: TuiTheme = createTuiTheme()): Styles {
  const identity = (s: string): string => s;
  if (theme.noColor) {
    return {
      accent: identity, user: identity, tool: identity, toolResult: identity,
      glyphOk: identity, glyphErr: identity, glyphRun: identity, thinking: identity,
      system: identity, error: identity, approval: identity, muted: identity,
      bold: identity, italic: identity, code: identity, link: identity, url: identity,
      quote: identity, diffAdd: identity, diffDel: identity, diffMeta: identity,
      diffContext: identity, frame: identity, match: identity,
    };
  }
  const c = {
    text: theme.text ?? "#eef2f7",
    muted: theme.muted ?? "#9aa3ad",
    accent: theme.accent ?? "#9bd7d8",
    warning: theme.warning ?? "#f2c94c",
    danger: theme.danger ?? "#ff7a8a",
    success: theme.success ?? "#95d475",
    cyan: theme.cyan ?? "#7dd7ff",
  };
  return {
    accent: (s) => chalk.hex(c.accent)(s),
    user: (s) => chalk.hex(c.text)(s),
    tool: (s) => chalk.hex(c.muted)(s),
    toolResult: (s) => chalk.hex(c.muted).dim(s),
    glyphOk: (s) => chalk.hex(c.success)(s),
    glyphErr: (s) => chalk.hex(c.danger)(s),
    glyphRun: (s) => chalk.hex(c.accent)(s),
    thinking: (s) => chalk.hex(c.muted).italic(s),
    system: (s) => chalk.hex(c.accent)(s),
    error: (s) => chalk.hex(c.danger)(s),
    approval: (s) => chalk.hex(c.warning)(s),
    muted: (s) => chalk.hex(c.muted)(s),
    bold: (s) => chalk.bold(s),
    italic: (s) => chalk.italic(s),
    code: (s) => chalk.hex(c.cyan).inverse(s),
    link: (s) => chalk.underline(s),
    url: (s) => chalk.hex(c.muted)(s),
    quote: (s) => chalk.hex(c.muted)(s),
    diffAdd: (s) => chalk.hex(c.success)(s),
    diffDel: (s) => chalk.hex(c.danger)(s),
    diffMeta: (s) => chalk.hex(c.accent)(s),
    diffContext: (s) => chalk.hex(c.muted)(s),
    frame: (s) => chalk.hex(c.muted)(s),
    match: (s) => chalk.inverse(s),
  };
}

export const styles = createStyles();
