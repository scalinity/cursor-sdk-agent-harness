import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ContextChip } from "@harness/shared";
import { extractImageDropPaths, formatImageChipLabel, shouldTreatAsImageDrop } from "../lib/attachments.js";
import type { ImageAttachment } from "../lib/attachments.js";
import { sanitizeTerminalText } from "../output/sanitize.js";
import type { MentionSelectionItem } from "../types.js";
import { bg, border, fg, hardWrapText, type TuiTheme } from "./theme.js";
import { mentionItemToChip } from "./MentionPopup.js";
import { isKnownSlashCommand, type KnownSlashCommandName, type SlashPaletteItem } from "./SlashPalette.js";
import { glyph } from "./glyphs.js";
import { shouldReserveArrowKeysForStreamScroll, shouldUseCtrlForPromptHistory } from "./stream-scroll.js";

export interface MentionTrigger {
  start: number;
  query: string;
}

export function findMentionTrigger(text: string, cursor: number): MentionTrigger | null {
  const before = text.slice(0, cursor);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;
  const prev = atIndex > 0 ? before[atIndex - 1] : "";
  if (prev && /[\w.]/.test(prev)) return null;
  const query = before.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { start: atIndex, query };
}

export interface ApplyMentionInput {
  text: string;
  cursor: number;
  chips: ContextChip[];
  item: MentionSelectionItem;
}

export function applyMentionSelection(input: ApplyMentionInput): { text: string; chips: ContextChip[] } {
  const trigger = findMentionTrigger(input.text, input.cursor);
  if (!trigger) return { text: input.text, chips: input.chips };
  const chip = mentionItemToChip(input.item, input.chips.length + 1);
  return {
    text: input.text.slice(0, trigger.start) + input.text.slice(input.cursor),
    chips: [...input.chips, chip],
  };
}

export type SlashCommandName = KnownSlashCommandName | "unknown";

export function parseSlashCommand(input: string): { command: SlashCommandName; args: string[] } | null {
  if (!input.startsWith("/")) return null;
  const parts = input.slice(1).trim().split(/\s+/).filter(Boolean);
  const head = parts[0] ?? "";
  if (isKnownSlashCommand(head)) return { command: head, args: parts.slice(1) };
  return { command: "unknown", args: parts };
}

export function isBackspaceInput(input: string, key: { backspace?: boolean; delete?: boolean }): boolean {
  return key.backspace === true || key.delete === true || input === "\u007f" || input === "\b";
}

export class PromptHistory {
  private index: number;
  constructor(private readonly entries: readonly string[]) {
    this.index = entries.length;
  }

  previous(current: string): string {
    if (current.length > 0 || this.entries.length === 0) return current;
    this.index = Math.max(0, this.index - 1);
    return this.entries[this.index] ?? "";
  }

  next(current: string): string {
    if (current.length > 0 || this.entries.length === 0) return current;
    this.index = Math.min(this.entries.length, this.index + 1);
    return this.index >= this.entries.length ? "" : this.entries[this.index] ?? "";
  }
}

export interface InputBarProps {
  disabled?: boolean;
  chips: ContextChip[];
  imageAttachments?: ImageAttachment[];
  history: PromptHistory;
  mentionItems?: MentionSelectionItem[];
  selectedMentionIndex?: number;
  slashItems?: readonly SlashPaletteItem[];
  selectedSlashIndex?: number;
  width?: number;
  maxVisibleLines?: number;
  /** When true, ↑/↓ scroll the stream and prompt history moves to Ctrl+↑/↓. */
  streamScrollActive?: boolean;
  theme: TuiTheme;
  focused?: boolean;
  onMentionNavigate?: (delta: number) => void;
  onMentionDismiss?: () => void;
  onMentionSelect?: (chips: ContextChip[]) => void;
  onSlashNavigate?: (delta: number) => void;
  onSlashSelect?: (item: SlashPaletteItem) => void;
  onSubmit: (text: string) => void;
  onChange?: (text: string, mention: MentionTrigger | null) => void;
  onClear?: () => void;
  onEscape?: () => void;
  onImageDrop?: (paths: string[]) => void;
  onRemoveLastImage?: () => void;
}

export function InputBar({
  disabled = false,
  chips,
  imageAttachments = [],
  history,
  mentionItems = [],
  selectedMentionIndex = 0,
  slashItems = [],
  selectedSlashIndex = 0,
  width = 80,
  maxVisibleLines = 4,
  streamScrollActive = false,
  focused = true,
  theme,
  onMentionNavigate,
  onMentionDismiss,
  onMentionSelect,
  onSlashNavigate,
  onSlashSelect,
  onSubmit,
  onChange,
  onClear,
  onEscape,
  onImageDrop,
  onRemoveLastImage,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const setDraft = (next: string) => {
    setValue(next);
    onChange?.(next, findMentionTrigger(next, next.length));
  };

  useInput((input, key) => {
    const isReturn = key.return || input === "\r" || input === "\n";
    if (mentionItems.length > 0) {
      if (key.upArrow) {
        onMentionNavigate?.(-1);
        return;
      }
      if (key.downArrow) {
        onMentionNavigate?.(1);
        return;
      }
      if (key.tab || isReturn) {
        const item = mentionItems[selectedMentionIndex];
        if (item) {
          const result = applyMentionSelection({ text: value, cursor: value.length, chips, item });
          setDraft(result.text);
          onMentionSelect?.(result.chips);
        }
        return;
      }
      if (key.escape) {
        onMentionDismiss?.();
        return;
      }
    }

    if (slashItems.length > 0) {
      if (key.upArrow) {
        onSlashNavigate?.(-1);
        return;
      }
      if (key.downArrow) {
        onSlashNavigate?.(1);
        return;
      }
      if (key.tab) {
        const item = slashItems[selectedSlashIndex];
        if (item) {
          const next = `/${item.command}${item.args ? " " : ""}`;
          setDraft(next);
          onSlashSelect?.(item);
        }
        return;
      }
      if (key.escape) {
        onEscape?.();
        return;
      }
    } else if (key.escape) {
      onEscape?.();
      return;
    }

    if (shouldReserveArrowKeysForStreamScroll(streamScrollActive) && (key.upArrow || key.downArrow) && !key.ctrl && !key.meta) return;

    if (key.ctrl && input === "c" && value.length > 0) {
      setDraft("");
      onClear?.();
      return;
    }
    const promptHistoryNeedsCtrl = shouldUseCtrlForPromptHistory(streamScrollActive);
    if (value.length === 0 && (key.upArrow || key.downArrow) && (!promptHistoryNeedsCtrl || key.ctrl)) {
      if (key.upArrow) {
        setDraft(history.previous(value));
        return;
      }
      if (key.downArrow) {
        setDraft(history.next(value));
        return;
      }
    }
    if (isBackspaceInput(input, key)) {
      if (value.length > 0) {
        setDraft(Array.from(value).slice(0, -1).join(""));
        return;
      }
      if (imageAttachments.length > 0) {
        onRemoveLastImage?.();
      }
      return;
    }
    if (isReturn) {
      if (key.shift) {
        setDraft(`${value}\n`);
        return;
      }
      const trimmed = value.trim();
      if ((!trimmed && imageAttachments.length === 0) || disabled) return;
      setDraft("");
      onSubmit(trimmed);
      return;
    }
    if (key.ctrl || key.meta || key.delete || key.leftArrow || key.rightArrow || key.pageDown || key.pageUp || key.tab) return;
    if (input.length > 0) {
      const dropPaths = extractImageDropPaths(input);
      if (dropPaths && shouldTreatAsImageDrop(input, dropPaths)) {
        onImageDrop?.(dropPaths);
        return;
      }
      setDraft(value + input.replace(/\r\n?/g, "\n"));
    }
  });

  const allVisibleLines = value.length > 0 ? value.split("\n").flatMap((line) => hardWrapText(line, Math.max(12, width - 8))) : [""];
  const hiddenLineCount = Math.max(0, allVisibleLines.length - maxVisibleLines);
  const visibleLines = allVisibleLines.slice(hiddenLineCount).map((line) => sanitizeTerminalText(line));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      {...border(focused ? theme.brand : theme.border)}
      paddingX={1}
      {...bg(theme.panel)}
    >
      {visibleLines.map((line, index) => (
        <Box key={`${hiddenLineCount + index}:${line}`}>
          {index === 0 ? (
            <>
              {chips.map((chip) => (
                <Text key={chip.id} {...fg(theme.muted)}>[{sanitizeTerminalText(chip.mention.displayLabel)}] </Text>
              ))}
              {imageAttachments.map((attachment) => (
                <Text key={attachment.id} {...fg(theme.muted)}>[img:{formatImageChipLabel(sanitizeTerminalText(attachment.name))}] </Text>
              ))}
            </>
          ) : null}
          <Text {...fg(focused ? theme.brand : theme.muted)}>{index === 0 ? `${glyph.running} ` : "  "}</Text>
          {hiddenLineCount > 0 && index === 0 ? <Text {...fg(theme.muted)}>... </Text> : null}
          {line.length > 0 ? <Text {...fg(theme.text)}>{line}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}
