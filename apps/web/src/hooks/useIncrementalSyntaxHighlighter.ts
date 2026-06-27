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

// Lezer highlight token classes → harness `tk-*` classes, in priority order
// (first matching group wins, matching the original sequential checks).
const TOKEN_CLASS_GROUPS: ReadonlyArray<readonly [target: string, tokens: readonly string[]]> = [
  ["tk-key", ["tok-keyword"]],
  ["tk-str", ["tok-string", "tok-string2"]],
  ["tk-num", ["tok-number"]],
  ["tk-cmt", ["tok-comment"]],
  ["tk-type", ["tok-typeName", "tok-className", "tok-namespace"]],
  ["tk-prop", ["tok-propertyName"]],
  ["tk-bool", ["tok-bool", "tok-atom"]],
  ["tk-var", ["tok-variableName", "tok-variableName2"]],
  ["tk-punct", ["tok-punctuation", "tok-operator"]],
];

function mapClassName(classes: string): string | null {
  const names = new Set(classes.split(/\s+/));
  for (const [target, tokens] of TOKEN_CLASS_GROUPS) {
    if (tokens.some((token) => names.has(token))) return target;
  }
  return null;
}

function shellDecorations(text: string): Decoration[] {
  const decorations: Decoration[] = [];
  const pattern = /#[^\n]*|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\s--?[A-Za-z0-9][\w-]*|\b(?:if|then|else|fi|for|do|done|case|esac|while|function|export|local)\b/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[0] ?? "";
    const index = match.index ?? 0;
    const trimmed = value.trimStart();
    const from = index + (value.length - trimmed.length);
    const to = index + value.length;
    let className: string;
    if (trimmed.startsWith("#")) {
      className = "tk-cmt";
    } else if (trimmed.startsWith("-")) {
      className = "tk-prop";
    } else if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
      className = "tk-str";
    } else {
      className = "tk-key";
    }
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
