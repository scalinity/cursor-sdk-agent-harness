export type JsonWriter = (line: string) => void;

export function toJsonLine(value: unknown): string {
  return JSON.stringify(value);
}

export function writeJsonLine(write: JsonWriter, value: unknown): void {
  write(toJsonLine(value));
}