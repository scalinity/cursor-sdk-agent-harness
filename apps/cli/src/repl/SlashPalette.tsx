import React from "react";
import { Box, Text } from "ink";
import { bg, border, fg, type TuiTheme } from "./theme.js";
import { glyph } from "./glyphs.js";

export interface SlashPaletteItem {
  command: string;
  args?: string;
  description: string;
}

export const SLASH_COMMANDS = [
  { command: "mode", args: "ask | agent", description: "switch execution mode" },
  { command: "model", args: "<id>", description: "switch model for this directory session" },
  { command: "skill", args: "create <name> <desc> | list", description: "create or list Cursor skills" },
  { command: "history", description: "show recent runs inline" },
  { command: "clear", description: "clear scrollback" },
  { command: "exit", description: "quit harness" },
  { command: "agent", args: "<id>", description: "advanced: attach a specific backing agent" },
] as const satisfies readonly SlashPaletteItem[];

export type KnownSlashCommandName = (typeof SLASH_COMMANDS)[number]["command"];

export function isKnownSlashCommand(command: string): command is KnownSlashCommandName {
  return SLASH_COMMANDS.some((item) => item.command === command);
}

export function filterSlashCommands(input: string): SlashPaletteItem[] {
  if (!input.startsWith("/")) return [];
  const body = input.slice(1);
  if (/\s/.test(body)) return [];
  const query = body.toLowerCase();
  if (!query) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter((item) => item.command.startsWith(query));
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
        return (
          <Text key={item.command} {...fg(theme.text)} bold={selected}>
            <Text {...fg(selected ? theme.state?.ready : theme.muted)}>{selected ? `${glyph.readyDot} ` : "  "}</Text> /{item.command}{item.args ? ` ${item.args}` : ""} <Text {...fg(theme.muted)}> - {item.description}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
