import * as smd from "streaming-markdown";
import type { Attr, Renderer, Token } from "streaming-markdown";

export type MarkdownBlock =
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { id: string; type: "list"; ordered: boolean; items: Array<{ id: string; text: string }> }
  | { id: string; type: "blockquote"; text: string }
  | { id: string; type: "code"; language: string | null; text: string; closed: boolean }
  | { id: string; type: "table"; rows: string[][]; closed: boolean }
  | { id: string; type: "thematic_break" };

export interface MarkdownWriteResult {
  structural: boolean;
  textBlockIds: string[];
}

type StackContext =
  | { kind: "paragraph"; block: Extract<MarkdownBlock, { type: "paragraph" }> }
  | { kind: "heading"; block: Extract<MarkdownBlock, { type: "heading" }> }
  | { kind: "list"; block: Extract<MarkdownBlock, { type: "list" }> }
  | { kind: "listItem"; item: { id: string; text: string } }
  | { kind: "blockquote"; block: Extract<MarkdownBlock, { type: "blockquote" }> }
  | { kind: "code"; block: Extract<MarkdownBlock, { type: "code" }> }
  | { kind: "table"; block: Extract<MarkdownBlock, { type: "table" }> }
  | { kind: "tableRow"; cells: string[] }
  | { kind: "tableCell"; text: string }
  | { kind: "lineBreak" }
  | { kind: "inline" };

type TextTarget =
  | { kind: "block"; block: Extract<MarkdownBlock, { type: "paragraph" | "heading" | "blockquote" | "code" }> }
  | { kind: "item"; item: { id: string; text: string }; listId: string }
  | { kind: "cell"; cell: Extract<StackContext, { kind: "tableCell" }>; tableId: string };

interface ProjectorData {
  blocks: MarkdownBlock[];
  stack: StackContext[];
  nextId: number;
  currentWrite: MarkdownWriteResult;
  lastTextTarget: TextTarget | null;
  pendingPreview: { target: TextTarget; text: string; provisionalBlockId?: string } | null;
}

export interface MarkdownProjector {
  write: (chunk: string) => MarkdownWriteResult;
  reset: () => void;
  getBlocks: () => MarkdownBlock[];
}

function makeId(data: ProjectorData): string {
  data.nextId += 1;
  return `md-${data.nextId}`;
}

function markStructural(data: ProjectorData): void {
  data.currentWrite.structural = true;
}

function markText(data: ProjectorData, blockId: string): void {
  if (!data.currentWrite.textBlockIds.includes(blockId)) {
    data.currentWrite.textBlockIds.push(blockId);
  }
}

function appendBlock(data: ProjectorData, block: MarkdownBlock): void {
  data.blocks.push(block);
  markStructural(data);
}

function isHeadingToken(type: Token): boolean {
  return (
    type === smd.HEADING_1 ||
    type === smd.HEADING_2 ||
    type === smd.HEADING_3 ||
    type === smd.HEADING_4 ||
    type === smd.HEADING_5 ||
    type === smd.HEADING_6
  );
}

function headingLevel(type: Token): 1 | 2 | 3 | 4 | 5 | 6 {
  if (type === smd.HEADING_1) return 1;
  if (type === smd.HEADING_2) return 2;
  if (type === smd.HEADING_3) return 3;
  if (type === smd.HEADING_4) return 4;
  if (type === smd.HEADING_5) return 5;
  return 6;
}

function appendText(data: ProjectorData, text: string): void {
  if (!text) return;
  for (let i = data.stack.length - 1; i >= 0; i -= 1) {
    const ctx = data.stack[i]!;
    if (ctx.kind === "tableCell") {
      ctx.text += text;
      const table = activeTable(data);
      if (table) {
        data.lastTextTarget = { kind: "cell", cell: ctx, tableId: table.id };
        markText(data, table.id);
      }
      return;
    }
    if (ctx.kind === "listItem") {
      ctx.item.text += text;
      const list = activeList(data);
      if (list) {
        data.lastTextTarget = { kind: "item", item: ctx.item, listId: list.id };
        markText(data, list.id);
      }
      return;
    }
    if (ctx.kind === "paragraph" || ctx.kind === "heading" || ctx.kind === "blockquote" || ctx.kind === "code") {
      ctx.block.text += text;
      data.lastTextTarget = { kind: "block", block: ctx.block };
      markText(data, ctx.block.id);
      return;
    }
  }
}

function activeList(data: ProjectorData): Extract<MarkdownBlock, { type: "list" }> | null {
  for (let i = data.stack.length - 1; i >= 0; i -= 1) {
    const ctx = data.stack[i]!;
    if (ctx.kind === "list") return ctx.block;
  }
  return null;
}

function activeTable(data: ProjectorData): Extract<MarkdownBlock, { type: "table" }> | null {
  for (let i = data.stack.length - 1; i >= 0; i -= 1) {
    const ctx = data.stack[i]!;
    if (ctx.kind === "table") return ctx.block;
  }
  return null;
}

function addToken(data: ProjectorData, type: Token): void {
  if (type === smd.PARAGRAPH) {
    const parent = data.stack[data.stack.length - 1];
    if (parent?.kind === "blockquote") {
      data.stack.push({ kind: "inline" });
      return;
    }
    const block: Extract<MarkdownBlock, { type: "paragraph" }> = {
      id: makeId(data),
      type: "paragraph",
      text: "",
    };
    appendBlock(data, block);
    data.stack.push({ kind: "paragraph", block });
    return;
  }
  if (isHeadingToken(type)) {
    const block: Extract<MarkdownBlock, { type: "heading" }> = {
      id: makeId(data),
      type: "heading",
      level: headingLevel(type),
      text: "",
    };
    appendBlock(data, block);
    data.stack.push({ kind: "heading", block });
    return;
  }
  if (type === smd.LIST_UNORDERED || type === smd.LIST_ORDERED) {
    const block: Extract<MarkdownBlock, { type: "list" }> = {
      id: makeId(data),
      type: "list",
      ordered: type === smd.LIST_ORDERED,
      items: [],
    };
    appendBlock(data, block);
    data.stack.push({ kind: "list", block });
    return;
  }
  if (type === smd.LIST_ITEM) {
    const list = activeList(data);
    const item = { id: makeId(data), text: "" };
    if (list) {
      list.items.push(item);
      markStructural(data);
    }
    data.stack.push({ kind: "listItem", item });
    return;
  }
  if (type === smd.BLOCKQUOTE) {
    const block: Extract<MarkdownBlock, { type: "blockquote" }> = {
      id: makeId(data),
      type: "blockquote",
      text: "",
    };
    appendBlock(data, block);
    data.stack.push({ kind: "blockquote", block });
    return;
  }
  if (type === smd.CODE_FENCE || type === smd.CODE_BLOCK) {
    const block: Extract<MarkdownBlock, { type: "code" }> = {
      id: makeId(data),
      type: "code",
      language: null,
      text: "",
      closed: false,
    };
    appendBlock(data, block);
    data.stack.push({ kind: "code", block });
    return;
  }
  if (type === smd.TABLE) {
    const block: Extract<MarkdownBlock, { type: "table" }> = {
      id: makeId(data),
      type: "table",
      rows: [],
      closed: false,
    };
    appendBlock(data, block);
    data.stack.push({ kind: "table", block });
    return;
  }
  if (type === smd.TABLE_ROW) {
    data.stack.push({ kind: "tableRow", cells: [] });
    return;
  }
  if (type === smd.TABLE_CELL) {
    data.stack.push({ kind: "tableCell", text: "" });
    return;
  }
  if (type === smd.RULE) {
    appendBlock(data, { id: makeId(data), type: "thematic_break" });
    data.stack.push({ kind: "inline" });
    return;
  }
  if (type === smd.LINE_BREAK) {
    appendText(data, "\n");
    data.stack.push({ kind: "lineBreak" });
    return;
  }
  data.stack.push({ kind: "inline" });
}

function endToken(data: ProjectorData): void {
  const ctx = data.stack.pop();
  if (!ctx) return;
  if (ctx.kind === "code") {
    ctx.block.closed = true;
    markStructural(data);
    return;
  }
  if (ctx.kind === "tableCell") {
    const row = data.stack[data.stack.length - 1];
    if (row?.kind === "tableRow") row.cells.push(ctx.text.trim());
    return;
  }
  if (ctx.kind === "tableRow") {
    const table = activeTable(data);
    if (table) {
      table.rows.push(ctx.cells);
      markStructural(data);
    }
    return;
  }
  if (ctx.kind === "table") {
    ctx.block.closed = true;
    markStructural(data);
  }
}

function setAttr(data: ProjectorData, type: Attr, value: string): void {
  if (type !== smd.LANG) return;
  for (let i = data.stack.length - 1; i >= 0; i -= 1) {
    const ctx = data.stack[i]!;
    if (ctx.kind === "code") {
      ctx.block.language = value.trim() || null;
      markStructural(data);
      return;
    }
  }
}

function cloneBlock(block: MarkdownBlock): MarkdownBlock {
  if (block.type === "list") {
    return { ...block, items: block.items.map((item) => ({ ...item })) };
  }
  if (block.type === "table") {
    return { ...block, rows: block.rows.map((row) => [...row]) };
  }
  return { ...block };
}

function createData(): ProjectorData {
  return {
    blocks: [],
    stack: [],
    nextId: 0,
    currentWrite: { structural: false, textBlockIds: [] },
    lastTextTarget: null,
    pendingPreview: null,
  };
}

function appendToTarget(target: TextTarget, text: string): void {
  if (target.kind === "block") target.block.text += text;
  else if (target.kind === "item") target.item.text += text;
  else target.cell.text += text;
}

function removePendingPreview(data: ProjectorData): void {
  const preview = data.pendingPreview;
  if (!preview) return;
  const text = preview.text;
  if (preview.target.kind === "block" && preview.target.block.text.endsWith(text)) {
    preview.target.block.text = preview.target.block.text.slice(0, -text.length);
    if (preview.provisionalBlockId && preview.target.block.text.length === 0) {
      data.blocks = data.blocks.filter((block) => block.id !== preview.provisionalBlockId);
      if (data.lastTextTarget === preview.target) data.lastTextTarget = null;
    }
  } else if (preview.target.kind === "item" && preview.target.item.text.endsWith(text)) {
    preview.target.item.text = preview.target.item.text.slice(0, -text.length);
  } else if (preview.target.kind === "cell" && preview.target.cell.text.endsWith(text)) {
    preview.target.cell.text = preview.target.cell.text.slice(0, -text.length);
  }
  data.pendingPreview = null;
}

function provisionalParagraphTarget(data: ProjectorData): TextTarget {
  const block: Extract<MarkdownBlock, { type: "paragraph" }> = {
    id: makeId(data),
    type: "paragraph",
    text: "",
  };
  data.blocks.push(block);
  markStructural(data);
  const target: TextTarget = { kind: "block", block };
  data.lastTextTarget = target;
  return target;
}

function readPendingParserText(parser: smd.Parser): string {
  // `streaming-markdown` keeps its optimistic tail in `pending`; OQ-21 records
  // this package choice, and tests cover this adapter so an upstream rename
  // fails locally instead of silently dropping the newest character.
  return (parser as smd.Parser & { pending?: string }).pending ?? "";
}

function previewPendingParserText(data: ProjectorData, parser: smd.Parser): void {
  const pending = readPendingParserText(parser);
  if (!pending || pending.includes("\n")) return;
  const existingTarget = data.lastTextTarget;
  const target = existingTarget ?? provisionalParagraphTarget(data);
  appendToTarget(target, pending);
  data.pendingPreview = {
    target,
    text: pending,
    ...(existingTarget === null && target.kind === "block" ? { provisionalBlockId: target.block.id } : {}),
  };
  if (target.kind === "block") markText(data, target.block.id);
  else if (target.kind === "item") markText(data, target.listId);
  else markText(data, target.tableId);
}

export function createMarkdownProjector(): MarkdownProjector {
  let data = createData();
  let parser = smd.parser(createRenderer(data));

  return {
    write: (chunk) => {
      data.currentWrite = { structural: false, textBlockIds: [] };
      removePendingPreview(data);
      smd.parser_write(parser, chunk);
      previewPendingParserText(data, parser);
      return {
        structural: data.currentWrite.structural,
        textBlockIds: [...data.currentWrite.textBlockIds],
      };
    },
    reset: () => {
      data = createData();
      parser = smd.parser(createRenderer(data));
    },
    getBlocks: () => data.blocks.map(cloneBlock),
  };
}

function createRenderer(data: ProjectorData): Renderer<ProjectorData> {
  return {
    data,
    add_token: addToken,
    end_token: endToken,
    add_text: appendText,
    set_attr: setAttr,
  };
}
