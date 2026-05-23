// Shared row ↔ domain helpers used by repository modules. Repositories own
// the boundary between snake_case SQL and camelCase TypeScript; mapping never
// leaks back into packages/shared.

export function isoNow(): string {
  return new Date().toISOString();
}

export function boolFromInt(value: number | null): boolean {
  return value === 1;
}

export function intFromBool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function parseJsonOrNull<T>(text: string | null): T | null {
  if (text === null) return null;
  return JSON.parse(text) as T;
}

export function stringifyOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

export function parseJsonArray<T>(text: string): T[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array column, got non-array value");
  }
  return parsed as T[];
}
