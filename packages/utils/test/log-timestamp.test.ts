import { describe, expect, it } from 'vitest';
import { normalizeNanosecondZuluTimestamp } from '../src';

describe('log timestamp helpers', (): void => {
  it('normalizes Zulu timestamps to nanosecond precision', (): void => {
    expect(normalizeNanosecondZuluTimestamp('2026-03-23T12:00:00Z')).toBe('2026-03-23T12:00:00.000000000Z');
    expect(normalizeNanosecondZuluTimestamp('2026-03-23T12:00:00.123Z')).toBe('2026-03-23T12:00:00.123000000Z');
    expect(normalizeNanosecondZuluTimestamp('2026-03-23T12:00:00.123456789Z')).toBe('2026-03-23T12:00:00.123456789Z');
  });

  it('returns null for non-normalizable timestamps', (): void => {
    expect(normalizeNanosecondZuluTimestamp('2026-03-23T12:00:00.123456789+00:00')).toBeNull();
    expect(normalizeNanosecondZuluTimestamp('not-a-timestamp')).toBeNull();
  });
});
