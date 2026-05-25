import { useCallback, useRef, useState } from "react";
import type { ContextSearchResult, ContextChip, ContextMentionKind } from "@harness/shared";
import { httpRequest } from "../lib/http-client.js";
import { useUiStore } from "../state/ui-store.js";
import { useCsrfToken } from "./useCsrfToken.js";
import { useMountEffect } from "./useMountEffect.js";

export interface UseMentionAutocompleteResult {
  isOpen: boolean;
  results: ContextSearchResult | null;
  selectedIndex: number;
  selectItem: (kind: ContextMentionKind, value: string, displayLabel: string) => void;
  dismiss: () => void;
  onInputChange: (text: string, cursorPosition: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => boolean;
  chips: ContextChip[];
  removeChip: (id: string) => void;
  clearChips: () => void;
}

export function useMentionAutocomplete(): UseMentionAutocompleteResult {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<ContextSearchResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [chips, setChips] = useState<ContextChip[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef("");
  const cursorPosRef = useRef(0);
  const chipIdRef = useRef(0);
  useCsrfToken();

  const fetchResults = useCallback(async (query: string) => {
    if (query.length === 0) {
      setResults(null);
      setIsOpen(false);
      return;
    }
    try {
      const data = await httpRequest(
        `/api/context/search`,
        { query: { q: query } },
      );
      const parsed = data as unknown as ContextSearchResult;
      setResults(parsed);
      setIsOpen(true);
      setSelectedIndex(0);
    } catch {
      setResults(null);
      setIsOpen(false);
    }
  }, []);

  const onInputChange = useCallback(
    (text: string, cursorPosition: number) => {
      // Find the @ trigger: scan backwards from cursor
      const before = text.slice(0, cursorPosition);
      const atIdx = before.lastIndexOf("@");
      if (atIdx === -1 || (atIdx > 0 && /\w/.test(before[atIdx - 1] ?? ""))) {
        // No @ or @ is inside a word
        if (isOpen) {
          setIsOpen(false);
          setResults(null);
        }
        return;
      }
      const query = before.slice(atIdx + 1);
      queryRef.current = query;
      cursorPosRef.current = cursorPosition;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void fetchResults(query);
      }, 150);
    },
    [fetchResults, isOpen],
  );

  const selectItem = useCallback(
    (kind: ContextMentionKind, value: string, displayLabel: string) => {
      const chip: ContextChip = {
        id: `chip-${++chipIdRef.current}`,
        mention: { kind, value, displayLabel },
      };
      setChips((prev) => [...prev, chip]);

      // Remove the @query text from the draft
      const draft = useUiStore.getState().composerDraft;
      const before = draft.slice(0, cursorPosRef.current);
      const atIdx = before.lastIndexOf("@");
      if (atIdx !== -1) {
        const newDraft = draft.slice(0, atIdx) + draft.slice(cursorPosRef.current);
        useUiStore.getState().setComposerDraft(newDraft);
      }

      setIsOpen(false);
      setResults(null);
    },
    [],
  );

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setResults(null);
  }, []);

  const removeChip = useCallback((id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearChips = useCallback(() => {
    setChips([]);
  }, []);

  const flatResults = useCallback(() => {
    if (!results) return [];
    const items: Array<{ kind: ContextMentionKind; value: string; label: string }> = [];
    for (const f of results.files) {
      items.push({
        kind: f.isDirectory ? "folder" : "file",
        value: f.path,
        label: f.name,
      });
    }
    for (const s of results.symbols) {
      items.push({
        kind: "symbol",
        value: s.name,
        label: s.name,
      });
    }
    return items;
  }, [results]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen) {
        // Backspace at the start removes last chip
        if (e.key === "Backspace" && chips.length > 0) {
          const target = e.target as HTMLTextAreaElement;
          if (target.selectionStart === 0 && target.selectionEnd === 0) {
            setChips((prev) => prev.slice(0, -1));
            return true;
          }
        }
        return false;
      }
      const items = flatResults();
      if (items.length === 0) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) {
          selectItem(item.kind, item.value, item.label);
        }
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return true;
      }
      return false;
    },
    [isOpen, chips.length, flatResults, selectedIndex, selectItem, dismiss],
  );

  useMountEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  });

  return {
    isOpen,
    results,
    selectedIndex,
    selectItem,
    dismiss,
    onInputChange,
    onKeyDown,
    chips,
    removeChip,
    clearChips,
  };
}
