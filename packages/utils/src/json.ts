import type { ZodType } from 'zod';

export type JsonPrimitive = boolean | number | string | null;

export interface JsonObject {
  [key: string]: JsonArray | JsonObject | JsonPrimitive;
}

export type JsonArray = (JsonArray | JsonObject | JsonPrimitive)[];
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export function parseJsonWith<TValue>(schema: ZodType<TValue>, raw: string): TValue {
  return schema.parse(JSON.parse(raw));
}
