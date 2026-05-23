import clsx, { type ClassValue } from "clsx";

/** Tiny className helper. Re-exports clsx under a stable name. */
export function cn(...values: ClassValue[]): string {
  return clsx(...values);
}
