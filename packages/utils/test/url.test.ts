import { describe, expect, it } from 'vitest';
import { readUrlOrigin } from '../src/url';

describe('readUrlOrigin', (): void => {
  it('returns the origin for a valid absolute url', (): void => {
    expect(readUrlOrigin('https://app.customer.example.com/path?x=1')).toBe('https://app.customer.example.com');
  });

  it('returns null for empty or invalid values', (): void => {
    expect(readUrlOrigin('')).toBeNull();
    expect(readUrlOrigin(undefined)).toBeNull();
    expect(readUrlOrigin('/relative/path')).toBeNull();
  });
});
