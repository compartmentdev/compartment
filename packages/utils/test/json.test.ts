import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonWith } from '../src/json';

describe('parseJsonWith', (): void => {
  const subjectSchema: z.ZodType<{ name: string }> = z.object({ name: z.string() });

  it('parses JSON that matches the supplied schema', (): void => {
    expect(parseJsonWith(subjectSchema, '{"name":"compartment"}')).toEqual({ name: 'compartment' });
  });

  it.each(['{', '{"name":42}'])('rejects invalid JSON or a schema mismatch', (raw: string): void => {
    expect((): { name: string } => parseJsonWith(subjectSchema, raw)).toThrow();
  });
});
