import { describe, expect, it } from 'vitest';

import { normalizeDnsHostname } from '../src';

describe('dns hostname helpers', (): void => {
  it('trims, lowercases, and strips trailing dots', (): void => {
    expect(normalizeDnsHostname('  Example.COM..  ')).toBe('example.com');
  });

  it('keeps interior dots unchanged', (): void => {
    expect(normalizeDnsHostname('API.Customer.Example.Com')).toBe('api.customer.example.com');
  });
});
