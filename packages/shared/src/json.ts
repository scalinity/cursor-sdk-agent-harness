import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export function safeStringify(value: JsonValue): string {
  return JSON.stringify(value);
}

export function safeParse(input: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(input));
}
