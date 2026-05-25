import type { RawData } from "ws";

/**
 * Normalise the four `ws` RawData shapes to a UTF-8 string. Both WS routes
 * (`/ws` run events and `/ws/terminal`) only speak JSON text frames, so we
 * coalesce everything to a string before handing to JSON.parse.
 */
export function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return (data as Buffer).toString("utf8");
}
