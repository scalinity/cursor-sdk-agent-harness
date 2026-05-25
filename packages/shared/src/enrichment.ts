import { z } from "zod";

// ---------------------------------------------------------------------------
// Documentation sources & search
// ---------------------------------------------------------------------------

export const docsSourceStatusSchema = z.enum([
  "pending",
  "crawling",
  "indexed",
  "error",
]);
export type DocsSourceStatus = z.infer<typeof docsSourceStatusSchema>;

export const docsSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  status: docsSourceStatusSchema,
  pageCount: z.number(),
  maxPages: z.number(),
  lastCrawledAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});
export type DocsSource = z.infer<typeof docsSourceSchema>;

export const addDocsSourceRequestSchema = z.object({
  name: z.string().min(1).max(200),
  baseUrl: z.string().url(),
  maxPages: z.number().int().min(1).max(500).default(100),
});
export type AddDocsSourceRequest = z.infer<typeof addDocsSourceRequestSchema>;

export const docsSearchQuerySchema = z.object({
  q: z.string().min(1).max(1000),
  sourceId: z.string().optional(),
  maxResults: z.coerce.number().int().min(1).max(50).default(10),
});
export type DocsSearchQuery = z.infer<typeof docsSearchQuerySchema>;

export const docsSearchResultItemSchema = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
  url: z.string(),
  title: z.string(),
  snippet: z.string(),
  rank: z.number(),
});

export const docsSearchResultSchema = z.object({
  results: z.array(docsSearchResultItemSchema),
});
export type DocsSearchResult = z.infer<typeof docsSearchResultSchema>;

// ---------------------------------------------------------------------------
// Notepads
// ---------------------------------------------------------------------------

export const notepadSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Notepad = z.infer<typeof notepadSchema>;

export const notepadSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  contentLength: z.number(),
  updatedAt: z.string(),
});
export type NotepadSummary = z.infer<typeof notepadSummarySchema>;

export const createNotepadRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/),
  content: z.string().default(""),
});
export type CreateNotepadRequest = z.infer<typeof createNotepadRequestSchema>;

export const updateNotepadContentRequestSchema = z.object({
  content: z.string(),
});
export type UpdateNotepadContentRequest = z.infer<typeof updateNotepadContentRequestSchema>;

export const renameNotepadRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/),
});
export type RenameNotepadRequest = z.infer<typeof renameNotepadRequestSchema>;

// ---------------------------------------------------------------------------
// Terminal AI (Cmd+K command generation)
// ---------------------------------------------------------------------------

export const generateCommandRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  shell: z.string().default("zsh"),
  cwd: z.string(),
  recentOutput: z.string().optional(),
});
export type GenerateCommandRequest = z.infer<typeof generateCommandRequestSchema>;

export const generateCommandResponseSchema = z.object({
  command: z.string(),
  explanation: z.string(),
  dangerous: z.boolean(),
});
export type GenerateCommandResponse = z.infer<typeof generateCommandResponseSchema>;

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

export const slashCommandSchema = z.object({
  id: z.string(),
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().max(500),
  template: z.string().min(1).max(10000),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SlashCommand = z.infer<typeof slashCommandSchema>;

export const createSlashCommandRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().max(500),
  template: z.string().min(1).max(10000),
});
export type CreateSlashCommandRequest = z.infer<typeof createSlashCommandRequestSchema>;

export const updateSlashCommandRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_-]*$/)
    .optional(),
  description: z.string().max(500).optional(),
  template: z.string().min(1).max(10000).optional(),
});
export type UpdateSlashCommandRequest = z.infer<typeof updateSlashCommandRequestSchema>;

export const expandCommandRequestSchema = z.object({
  variables: z.record(z.string()),
});
export type ExpandCommandRequest = z.infer<typeof expandCommandRequestSchema>;

export const expandCommandResponseSchema = z.object({
  expandedText: z.string(),
});
export type ExpandCommandResponse = z.infer<typeof expandCommandResponseSchema>;

export const slashCommandVariableSchema = z.object({
  name: z.string(),
  placeholder: z.string().optional(),
});
export type SlashCommandVariable = z.infer<typeof slashCommandVariableSchema>;
