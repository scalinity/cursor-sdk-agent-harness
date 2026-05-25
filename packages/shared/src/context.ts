import { z } from "zod";

// ---------------------------------------------------------------------------
// @-Mention system
// ---------------------------------------------------------------------------

export const contextMentionKindSchema = z.enum([
  "file",
  "folder",
  "symbol",
  "codebase",
  "rules",
  "docs",
  "notepad",
]);
export type ContextMentionKind = z.infer<typeof contextMentionKindSchema>;

export const contextMentionSchema = z.object({
  kind: contextMentionKindSchema,
  value: z.string(),
  displayLabel: z.string(),
  resolvedContent: z.string().optional(),
});
export type ContextMention = z.infer<typeof contextMentionSchema>;

export const contextChipSchema = z.object({
  id: z.string(),
  mention: contextMentionSchema,
  tokenEstimate: z.number().optional(),
});
export type ContextChip = z.infer<typeof contextChipSchema>;

// ---------------------------------------------------------------------------
// Context search (autocomplete results)
// ---------------------------------------------------------------------------

export const symbolKindSchema = z.enum([
  "function",
  "class",
  "type",
  "interface",
  "variable",
  "enum",
  "method",
]);
export type SymbolKind = z.infer<typeof symbolKindSchema>;

export const contextSearchResultSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      isDirectory: z.boolean(),
      size: z.number().optional(),
    }),
  ),
  symbols: z.array(
    z.object({
      name: z.string(),
      kind: symbolKindSchema,
      path: z.string(),
      line: z.number(),
      preview: z.string(),
    }),
  ),
});
export type ContextSearchResult = z.infer<typeof contextSearchResultSchema>;

// ---------------------------------------------------------------------------
// Context resolution (server-side content fetching)
// ---------------------------------------------------------------------------

export const contextResolveRequestSchema = z.object({
  mentions: z.array(contextMentionSchema),
  workspaceId: z.string().optional(),
});
export type ContextResolveRequest = z.infer<typeof contextResolveRequestSchema>;

export const resolvedMentionSchema = z.object({
  mention: contextMentionSchema,
  content: z.string(),
  tokenEstimate: z.number(),
  truncated: z.boolean(),
});
export type ResolvedMention = z.infer<typeof resolvedMentionSchema>;

export const contextResolveResponseSchema = z.object({
  resolved: z.array(resolvedMentionSchema),
  totalTokenEstimate: z.number(),
});
export type ContextResolveResponse = z.infer<typeof contextResolveResponseSchema>;

// ---------------------------------------------------------------------------
// Project rules
// ---------------------------------------------------------------------------

export const ruleScopeSchema = z.enum(["always", "glob", "manual"]);
export type RuleScope = z.infer<typeof ruleScopeSchema>;

export const projectRuleSchema = z.object({
  name: z.string(),
  scope: ruleScopeSchema,
  glob: z.string().optional(),
  description: z.string(),
  content: z.string(),
  filePath: z.string(),
});
export type ProjectRule = z.infer<typeof projectRuleSchema>;

// ---------------------------------------------------------------------------
// Grep / codebase search
// ---------------------------------------------------------------------------

export const grepSearchQuerySchema = z.object({
  q: z.string().min(1).max(1000),
  workspaceId: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(200).default(50),
  filePattern: z.string().optional(),
  caseSensitive: z.coerce.boolean().default(false),
});
export type GrepSearchQuery = z.infer<typeof grepSearchQuerySchema>;

export const grepSearchResultItemSchema = z.object({
  path: z.string(),
  line: z.number(),
  column: z.number(),
  content: z.string(),
  contextBefore: z.array(z.string()),
  contextAfter: z.array(z.string()),
});

export const grepSearchResultSchema = z.object({
  results: z.array(grepSearchResultItemSchema),
  totalMatches: z.number(),
  truncated: z.boolean(),
  durationMs: z.number(),
});
export type GrepSearchResult = z.infer<typeof grepSearchResultSchema>;

export const fileSearchQuerySchema = z.object({
  pattern: z.string().min(1).max(500),
  workspaceId: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(100).default(30),
});
export type FileSearchQuery = z.infer<typeof fileSearchQuerySchema>;

export const fileSearchResultSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      size: z.number(),
      modifiedAt: z.string(),
    }),
  ),
  truncated: z.boolean(),
});
export type FileSearchResult = z.infer<typeof fileSearchResultSchema>;

// ---------------------------------------------------------------------------
// Context search endpoint (autocomplete)
// ---------------------------------------------------------------------------

export const contextSearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  kinds: z.string().optional(),
  workspaceId: z.string().optional(),
});
export type ContextSearchQuery = z.infer<typeof contextSearchQuerySchema>;
