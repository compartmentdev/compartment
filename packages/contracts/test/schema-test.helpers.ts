import { expect } from 'vitest';
import type { ZodType } from 'zod';

export function expectSchemaRejects<TOutput, TInput>(schema: ZodType<TOutput>, payload: TInput): void {
  expect(schema.safeParse(payload).success).toBe(false);
}

export function expectPresent<T>(value: T | null | undefined, label: string): T {
  expect(value, `${label} should be present`).not.toBeNull();
  expect(value, `${label} should be present`).not.toBeUndefined();
  return value as T;
}
