import { useEffect, useMemo, useState } from "react";
import type { KnownLanguage } from "@harness/shared";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { getParserForLanguage } from "../lib/lezer-parsers.js";

export interface ChangedRange {
  from: number;
  to: number;
  insertedLength: number;
}

export interface IncrementalHighlightInput {
  language: KnownLanguage;
  text: string;
  version: number;
  changedRange?: ChangedRange | undefined;
  cacheKey?: string | undefined;
}

export interface Decoration {
  from: number;
  to: number;
  className: string;
}

const EMPTY_DECORATIONS: Decoration[] = [];

function mapClassName(classes: string): string | null {
  const names = classes.split(/\s+/);
  if (names.some((name) => name === "tok-keyword")) return "tk-key";
  if (names.some((name) => name === "tok-string" || name === "tok-string2")) return "tk-str";
  if (names.some((name) => name === "tok-number")) return "tk-num";
  if (names.some((name) => name === "tok-comment")) return "tk-cmt";
  if (names.some((name) => name === "tok-typeName" || name === "tok-className" || name === "tok-namespace")) return "tk-type";
  if (names.some((name) => name === "tok-propertyName")) return "tk-prop";
  if (names.some((name) => name === "tok-bool" || name === "tok-atom")) return "tk-bool";
  if (names.some((name) => name === "tok-variableName" || name === "tok-variableName2")) return "tk-var";
  if (names.some((name) => name === "tok-punctuation" || name === "tok-operator")) return "tk-punct";
  return null;
}

function shellDecorations(text: string): Decoration[] {
  const decorations: Decoration[] = [];
  const pattern = /#[^\n]*|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\s--?[A-Za-z0-9][\w-]*|\b(?:if|then|else|fi|for|do|done|case|esac|while|function|export|local)\b/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[0] ?? "";
    const index = match.index ?? 0;
    const trimmedStart = value.length - value.trimStart().length;
    const from = index + trimmedStart;
    const to = index + value.length;
    const className = value.trimStart().startsWith("#")
      ? "tk-cmt"
      : value.trimStart().startsWith("-")
        ? "tk-prop"
        : value.trimStart().startsWith("\"") || value.trimStart().startsWith("'")
          ? "tk-str"
          : "tk-key";
    decorations.push({ from, to, className });
  }
  return decorations;
}

function mergeAdjacentDecorations(decorations: Decoration[]): Decoration[] {
  const merged: Decoration[] = [];
  for (const decoration of decorations) {
    const previous = merged[merged.length - 1];
    if (previous && previous.to === decoration.from && previous.className === decoration.className) {
      previous.to = decoration.to;
    } else if (decoration.to > decoration.from) {
      merged.push({ ...decoration });
    }
  }
  return merged;
}

export function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function useIncrementalSyntaxHighlighter(input: IncrementalHighlightInput): Decoration[] {
  const [decorations, setDecorations] = useState<Decoration[]>(EMPTY_DECORATIONS);
  const stableKey = useMemo(
    () => `${input.cacheKey ?? input.language}:${input.version.toString()}:${input.text.length.toString()}`,
    [input.cacheKey, input.language, input.version, input.text.length],
  );

  useEffect(() => {
    let cancelled = false;
    if (input.language === "plain-text" || input.text.length === 0) {
      setDecorations(EMPTY_DECORATIONS);
      return;
    }

    void getParserForLanguage(input.language)
      .then((entry) => {
        if (cancelled) return;
        if (entry.kind === "plain-text") {
          setDecorations(EMPTY_DECORATIONS);
          return;
        }
        if (entry.kind === "shell-regex") {
          setDecorations(shellDecorations(input.text));
          return;
        }

        const nextDecorations: Decoration[] = [];
        const tree = entry.parser.parse(input.text);
        highlightTree(tree, classHighlighter, (from, to, classes) => {
          const className = mapClassName(classes);
          if (className !== null) nextDecorations.push({ from, to, className });
        });
        setDecorations(mergeAdjacentDecorations(nextDecorations));
      })
      .catch(() => {
        if (!cancelled) setDecorations(EMPTY_DECORATIONS);
      });

    return () => {
      cancelled = true;
    };
  }, [input.language, input.text, stableKey]);

  void input.changedRange;
  return decorations;
}
