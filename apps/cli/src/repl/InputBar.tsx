import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ContextChip } from "@harness/shared";
import type { MentionSelectionItem } from "../types.js";
import { mentionItemToChip } from "./MentionPopup.js";

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

export type SlashCommandName = "mode" | "agent" | "model" | "clear" | "history" | "exit" | "unknown";

export function parseSlashCommand(input: string): { command: SlashCommandName; args: string[] } | null {
  if (!input.startsWith("/")) return null;
  const parts = input.slice(1).trim().split(/\s+/).filter(Boolean);
  const head = parts[0] ?? "";
  const known = new Set(["mode", "agent", "model", "clear", "history", "exit"]);
  if (known.has(head)) return { command: head as SlashCommandName, args: parts.slice(1) };
  return { command: "unknown", args: parts };
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
  history: PromptHistory;
  mentionItems?: MentionSelectionItem[];
  selectedMentionIndex?: number;
  onMentionNavigate?: (delta: number) => void;
  onMentionDismiss?: () => void;
  onMentionSelect?: (chips: ContextChip[]) => void;
  onSubmit: (text: string) => void;
  onChange?: (text: string, mention: MentionTrigger | null) => void;
  onClear?: () => void;
}

export function InputBar({
  disabled = false,
  chips,
  history,
  mentionItems = [],
  selectedMentionIndex = 0,
  onMentionNavigate,
  onMentionDismiss,
  onMentionSelect,
  onSubmit,
  onChange,
  onClear,
}: InputBarProps) {
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (mentionItems.length > 0) {
      if (key.upArrow) {
        onMentionNavigate?.(-1);
        return;
      }
      if (key.downArrow) {
        onMentionNavigate?.(1);
        return;
      }
      if (key.tab || key.return) {
        const item = mentionItems[selectedMentionIndex];
        if (item) {
          const result = applyMentionSelection({ text: value, cursor: value.length, chips, item });
          setValue(result.text);
          onMentionSelect?.(result.chips);
          onChange?.(result.text, findMentionTrigger(result.text, result.text.length));
        }
        return;
      }
      if (key.escape) {
        onMentionDismiss?.();
        return;
      }
    }
    if (key.upArrow && value.length === 0) setValue(history.previous(value));
    if (key.downArrow && value.length === 0) setValue(history.next(value));
    if (key.ctrl && input === "c" && value.length > 0) {
      setValue("");
      onClear?.();
    }
  });
  return (
    <Box>
      {chips.map((chip) => (
        <Text key={chip.id} color="cyan">[@{chip.mention.displayLabel}] </Text>
      ))}
      <Text color="cyan">❯ </Text>
      <TextInput
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next, findMentionTrigger(next, next.length));
        }}
        onSubmit={(submitted) => {
          const trimmed = submitted.trim();
          if (!trimmed || disabled) return;
          setValue("");
          onSubmit(trimmed);
        }}
      />
    </Box>
  );
}
