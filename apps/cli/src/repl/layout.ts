import { MIN_COLUMNS, MIN_ROWS } from "./theme.js";

export interface TerminalSize {
  columns: number;
  rows: number;
}

export interface TuiLayout {
  columns: number;
  rows: number;
  canRender: boolean;
  headerHeight: number;
  scrollHeight: number;
  overlayHeight: number;
  inputHeight: number;
  footerHeight: number;
}

export function normalizeTerminalSize(columns: number | undefined, rows: number | undefined): TerminalSize {
  return {
    columns: Math.max(1, columns ?? 80),
    rows: Math.max(1, rows ?? 24),
  };
}

export function computeTuiLayout(size: TerminalSize, inputLineCount: number, overlayLineCount: number): TuiLayout {
  const headerHeight = 2;
  const footerHeight = 1;
  const inputHeight = Math.min(6, Math.max(3, inputLineCount + 2));
  const overlayHeight = Math.min(9, Math.max(0, overlayLineCount));
  const canRender = size.columns >= MIN_COLUMNS && size.rows >= MIN_ROWS;
  const scrollHeight = Math.max(1, size.rows - headerHeight - footerHeight - inputHeight - overlayHeight);
  return {
    columns: size.columns,
    rows: size.rows,
    canRender,
    headerHeight,
    scrollHeight,
    overlayHeight,
    inputHeight,
    footerHeight,
  };
}

export function countInputLines(input: string): number {
  return Math.max(1, input.split("\n").length);
}
