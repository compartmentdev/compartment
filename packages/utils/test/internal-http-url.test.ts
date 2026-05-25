import { describe, expect, it } from 'vitest';
import { buildInternalHttpUrl } from '../src/internal-http-url';

describe('buildInternalHttpUrl', (): void => {
  it('builds an internal http url for an IPv4 host', (): void => {
    expect(buildInternalHttpUrl('127.0.0.1', 9443)).toBe('http://127.0.0.1:9443');
  });

  it('builds an internal http url for a hostname', (): void => {
    expect(buildInternalHttpUrl('api', 39444)).toBe('http://api:39444');
  });

  it('brackets an IPv6 host in an internal http url', (): void => {
    expect(buildInternalHttpUrl('::1', 9443)).toBe('http://[::1]:9443');
    expect(buildInternalHttpUrl('2001:db8::1', 39444)).toBe('http://[2001:db8::1]:39444');
  });
});
