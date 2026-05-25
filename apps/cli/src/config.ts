import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:4783";
export const DEFAULT_WEB_ORIGIN = "http://127.0.0.1:5173";
export const DEFAULT_MODEL_ID = "composer-2-5-fast";
export const CONFIG_DIR = path.join(homedir(), ".harness-cli");
export const HISTORY_PATH = path.join(CONFIG_DIR, "history");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export interface CliPreferences {
  lastAgentId?: string;
  preferredMode?: "ask" | "agent";
  preferredModel?: string;
}

export function resolveServerUrl(flagValue?: string): string {
  return (flagValue ?? process.env.HARNESS_SERVER_URL ?? DEFAULT_SERVER_URL).replace(/\/$/, "");
}

export function resolveWebOrigin(flagValue?: string): string {
  return (flagValue ?? process.env.HARNESS_WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN).replace(/\/$/, "");
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export async function readPreferences(): Promise<CliPreferences> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const prefs: CliPreferences = {};
    if (typeof record.lastAgentId === "string") prefs.lastAgentId = record.lastAgentId;
    if (record.preferredMode === "ask" || record.preferredMode === "agent") prefs.preferredMode = record.preferredMode;
    if (typeof record.preferredModel === "string") prefs.preferredModel = record.preferredModel;
    return prefs;
  } catch {
    return {};
  }
}

export async function writePreferences(prefs: CliPreferences): Promise<void> {
  await ensureConfigDir();
  await writePrivateFile(CONFIG_PATH, `${JSON.stringify(prefs, null, 2)}\n`);
}

export async function readPromptHistory(): Promise<string[]> {
  try {
    const raw = await readFile(HISTORY_PATH, "utf8");
    return raw.split("\n").map((line) => line.trimEnd()).filter(Boolean).slice(-500);
  } catch {
    return [];
  }
}

export async function appendPromptHistory(prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  await ensureConfigDir();
  const history = await readPromptHistory();
  const next = [...history.filter((line) => line !== trimmed), trimmed].slice(-500);
  await writePrivateFile(HISTORY_PATH, `${next.join("\n")}\n`);
}

async function writePrivateFile(targetPath: string, content: string): Promise<void> {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, targetPath);
}
