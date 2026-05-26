import { describe, expect, it } from 'vitest';
import { hasDuplicateSearchParam, readSingleSearchParam, readUrlOrigin } from '../src/url';

describe('hasDuplicateSearchParam', (): void => {
  it('detects repeated search params by name', (): void => {
    const searchParams: URLSearchParams = new URLSearchParams('code=abc&code=def&state=flow');

    expect(hasDuplicateSearchParam(searchParams, 'code')).toBe(true);
    expect(hasDuplicateSearchParam(searchParams, 'state')).toBe(false);
  });
});

describe('readSingleSearchParam', (): void => {
  it('returns only uniquely provided search param values', (): void => {
    const searchParams: URLSearchParams = new URLSearchParams('code=abc&state=flow&state=attacker-flow');

    expect(readSingleSearchParam(searchParams, 'code')).toBe('abc');
    expect(readSingleSearchParam(searchParams, 'state')).toBeNull();
    expect(readSingleSearchParam(searchParams, 'missing')).toBeNull();
  });
});

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
