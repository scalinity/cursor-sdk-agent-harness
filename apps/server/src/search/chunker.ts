/**
 * Phase 23 — Source-file chunking for embeddings.
 *
 * Line-based, char-budgeted, overlapping chunks. ~512 tokens (~2000 chars)
 * per chunk with ~128 tokens (~500 chars) of overlap between consecutive
 * chunks. When a chunk reaches the budget the splitter prefers a natural
 * boundary in the tail window — a blank line, or the start of a top-level
 * declaration — so functions/classes tend to stay intact. Files smaller
 * than the budget become a single chunk.
 */

export interface CodeChunk {
  content: string;
  /** 1-based inclusive line numbers. */
  startLine: number;
  endLine: number;
  /** Chunk index within the file. */
  index: number;
}

export const CHUNK_CHAR_BUDGET = 2000;
export const CHUNK_OVERLAP_CHARS = 500;

// Tail window (fraction of budget) in which a natural boundary is preferred.
const BOUNDARY_WINDOW = 0.3;

// Lines that begin a top-level-ish declaration across the supported languages.
const DECL_RE =
  /^\s*(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|def|func|fn|public|private|protected|impl|struct|trait|module|package)\b/;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

export function chunkText(content: string): CodeChunk[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  // Per-line cost includes the newline that join() will re-add.
  const cost = lines.map((l) => l.length + 1);

  // Whole file fits in one chunk.
  if (content.length <= CHUNK_CHAR_BUDGET) {
    return [{ content, startLine: 1, endLine: lines.length, index: 0 }];
  }

  const chunks: CodeChunk[] = [];
  let start = 0; // 0-based line index
  let chunkIndex = 0;

  while (start < lines.length) {
    // Grow until the budget is exceeded.
    let end = start;
    let acc = 0;
    while (end < lines.length) {
      const next = acc + (cost[end] ?? 0);
      if (next > CHUNK_CHAR_BUDGET && end > start) break;
      acc = next;
      end += 1;
    }
    end -= 1; // last included line (0-based)
    if (end < start) end = start; // single oversized line

    // Prefer a natural boundary within the tail window.
    end = preferBoundary(lines, cost, start, end);

    const startLine = start + 1;
    const endLine = end + 1;
    const slice = lines.slice(start, end + 1).join("\n");
    chunks.push({ content: slice, startLine, endLine, index: chunkIndex });
    chunkIndex += 1;

    if (end + 1 >= lines.length) break;

    // Next chunk starts back by ~overlap chars, but always makes progress.
    let overlap = 0;
    let nextStart = end + 1;
    for (let i = end; i > start; i--) {
      overlap += cost[i] ?? 0;
      if (overlap >= CHUNK_OVERLAP_CHARS) {
        nextStart = i;
        break;
      }
      nextStart = i;
    }
    if (nextStart <= start) nextStart = end + 1; // guarantee forward progress
    start = nextStart;
  }

  return chunks;
}

function preferBoundary(
  lines: string[],
  cost: number[],
  start: number,
  end: number,
): number {
  if (end <= start) return end;
  let windowChars = 0;
  let bestBlank = -1;
  let bestDecl = -1;
  const limit = CHUNK_CHAR_BUDGET * BOUNDARY_WINDOW;
  for (let i = end; i > start; i--) {
    windowChars += cost[i] ?? 0;
    if (windowChars > limit) break;
    const line = lines[i] ?? "";
    if (isBlank(line) && bestBlank === -1) bestBlank = i - 1; // end before the blank (it starts the next chunk)
    if (DECL_RE.test(line) && bestDecl === -1) bestDecl = i - 1; // cut before the decl
  }
  if (bestBlank > start) return bestBlank;
  if (bestDecl > start) return bestDecl;
  return end;
}
