import React from "react";
import { Box, Text } from "ink";
import { bg, border, fg, type TuiTheme } from "./theme.js";
import { glyph } from "./glyphs.js";

export interface SlashPaletteItem {
  command: string;
  args?: string;
  description: string;
  kind?: "builtin" | "skill";
}

export const SLASH_COMMANDS = [
  { command: "mode", args: "ask | agent", description: "switch execution mode", kind: "builtin" },
  { command: "model", args: "[id]", description: "switch model (no id opens the catalog picker)", kind: "builtin" },
  { command: "effort", args: "[level|default]", description: "set the model's thinking/effort level (default clears it)", kind: "builtin" },
  { command: "skill", args: "create <name> <desc> | list", description: "create or list Cursor skills", kind: "builtin" },
  { command: "history", description: "show recent runs inline", kind: "builtin" },
  { command: "clear", description: "clear scrollback", kind: "builtin" },
  { command: "exit", description: "quit Orrery", kind: "builtin" },
  { command: "agent", args: "<id>", description: "advanced: attach a specific backing agent", kind: "builtin" },
] as const satisfies readonly SlashPaletteItem[];

export type KnownSlashCommandName = (typeof SLASH_COMMANDS)[number]["command"];

export function isKnownSlashCommand(command: string): command is KnownSlashCommandName {
  return SLASH_COMMANDS.some((item) => item.command === command);
}

export function filterSlashCommands(input: string, extraItems: readonly SlashPaletteItem[] = []): SlashPaletteItem[] {
  if (!input.startsWith("/")) return [];
  const body = input.slice(1);
  if (/\s/.test(body)) return [];
  const query = body.toLowerCase();
  const seen = new Set<string>();
  const merged: SlashPaletteItem[] = [];
  for (const item of SLASH_COMMANDS) {
    if (seen.has(item.command)) continue;
    seen.add(item.command);
    merged.push(item);
  }
  for (const item of extraItems) {
    if (seen.has(item.command)) continue;
    seen.add(item.command);
    merged.push(item);
  }
  if (!query) return merged;
  return merged.filter((item) => item.command.startsWith(query));
}

export interface SlashPaletteProps {
  items: readonly SlashPaletteItem[];
  selectedIndex: number;
  theme: TuiTheme;
  focused?: boolean;
}

export function SlashPalette({ items, selectedIndex, theme }: SlashPaletteProps) {
  if (items.length === 0) return null;
  const borderColor = theme.border;
  return (
    <Box flexDirection="column" borderStyle="round" {...border(borderColor)} paddingX={1} {...bg(theme.panel)}>
      <Text {...fg(theme.muted)}>COMMAND DECK</Text>
      {items.slice(0, 6).map((item, index) => {
        const selected = index === selectedIndex;
        const isSkill = item.kind === "skill";
        const marker = isSkill ? glyph.skill : glyph.readyDot;
        const label = isSkill ? "skill" : "cmd";
        const descMax = 60;
        const desc = item.description.length > descMax ? `${item.description.slice(0, descMax - 1)}…` : item.description;
        return (
          <Text key={`${item.kind ?? "builtin"}-${item.command}`} {...fg(theme.text)} bold={selected}>
            <Text {...fg(selected ? theme.state?.ready : theme.muted)}>{selected ? `${marker} ` : "  "}</Text> /{item.command}{item.args ? ` ${item.args}` : ""} <Text {...fg(theme.muted)}> - {desc}</Text> <Text {...fg(theme.muted)} dimColor>[{label}]</Text>
          </Text>
        );
      })}
    </Box>
  );
}
