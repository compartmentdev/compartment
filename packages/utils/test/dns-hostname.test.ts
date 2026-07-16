import { describe, expect, it } from 'vitest';

import { isValidDnsHostname, normalizeDnsHostname } from '../src';

describe('dns hostname helpers', (): void => {
  it('trims, lowercases, and strips trailing dots', (): void => {
    expect(normalizeDnsHostname('  Example.COM..  ')).toBe('example.com');
  });

  it('keeps interior dots unchanged', (): void => {
    expect(normalizeDnsHostname('API.Customer.Example.Com')).toBe('api.customer.example.com');
  });

  it('accepts only complete DNS labels', (): void => {
    expect(isValidDnsHostname('localhost')).toBe(true);
    expect(isValidDnsHostname('apps.example.com')).toBe(true);
    expect(isValidDnsHostname('foo..example.com')).toBe(false);
    expect(isValidDnsHostname('-foo.example.com')).toBe(false);
    expect(isValidDnsHostname('apps.example.com,images.api.tag=evil')).toBe(false);
  });
});
