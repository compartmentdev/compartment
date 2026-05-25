import type { JsonValue } from '@compartment/utils';

export type JsonRecord = Record<string, JsonValue | undefined>;

export function readJsonRecord(value: JsonValue, label: string = 'JSON value'): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return value;
}

export function readJsonValue(value: string): JsonValue | null {
  const trimmedValue: string = value.trim();
  if (trimmedValue === '') {
    return null;
  }

  try {
    return JSON.parse(trimmedValue) as JsonValue;
  } catch {
    return null;
  }
}

export function readRequiredString(record: JsonRecord, key: string, label: string = 'JSON object'): string {
  const value: JsonValue | undefined = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is missing ${key}.`);
  }

  return value;
}
