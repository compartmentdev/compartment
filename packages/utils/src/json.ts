export type JsonPrimitive = boolean | number | string | null;

export interface JsonObject {
  [key: string]: JsonArray | JsonObject | JsonPrimitive;
}

export type JsonArray = (JsonArray | JsonObject | JsonPrimitive)[];
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
