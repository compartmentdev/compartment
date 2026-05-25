import { createHash } from 'node:crypto';

type StableJsonValue = boolean | number | string | null | StableJsonValue[] | StableJsonObject;

interface StableJsonObject {
  [key: string]: StableJsonValue | undefined;
}

export function hashSystemDomainIdempotencyPayload(value: object): string {
  return createHash('sha256')
    .update(stableStringify(value as StableJsonObject))
    .digest('hex');
}

function stableStringify(value: StableJsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort((leftKey: string, rightKey: string): number => leftKey.localeCompare(rightKey))
      .map((key: string): string => `${JSON.stringify(key)}:${stableStringify(readStableObjectValue(value, key))}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function readStableObjectValue(value: StableJsonObject, key: string): StableJsonValue {
  return value[key] ?? null;
}
