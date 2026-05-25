import { describe, expect, it } from 'vitest';
import { parseHttpHostAuthority } from '../src/http-host-authority';

describe('HTTP Host authority parsing', (): void => {
  it('normalizes bare hosts and hostnames with numeric ports', (): void => {
    expect(parseHttpHostAuthority('Billing.Localhost')).toEqual({
      authority: 'billing.localhost',
      host: 'billing.localhost',
    });
    expect(parseHttpHostAuthority('billing.localhost:443')).toEqual({
      authority: 'billing.localhost:443',
      host: 'billing.localhost',
    });
    expect(parseHttpHostAuthority('billing.localhost:80')).toEqual({
      authority: 'billing.localhost:80',
      host: 'billing.localhost',
    });
    expect(parseHttpHostAuthority('127.0.0.1:9080')).toEqual({
      authority: '127.0.0.1:9080',
      host: '127.0.0.1',
    });
  });

  it('accepts valid bracketed IPv6 authority values', (): void => {
    expect(parseHttpHostAuthority('[::1]:9080')).toEqual({
      authority: '[::1]:9080',
      host: '[::1]',
    });
  });

  it('rejects malformed authority values', (): void => {
    expect(parseHttpHostAuthority('billing.localhost:evil')).toBeNull();
    expect(parseHttpHostAuthority('billing.localhost:')).toBeNull();
    expect(parseHttpHostAuthority('billing.localhost:443:444')).toBeNull();
    expect(parseHttpHostAuthority('user@billing.localhost')).toBeNull();
    expect(parseHttpHostAuthority('billing.localhost/path')).toBeNull();
    expect(parseHttpHostAuthority('billing.localhost?next=/dashboard')).toBeNull();
    expect(parseHttpHostAuthority(' billing.localhost')).toBeNull();
    expect(parseHttpHostAuthority('billing%2elocalhost')).toBeNull();
    expect(parseHttpHostAuthority('%62illing.localhost')).toBeNull();
    expect(parseHttpHostAuthority('0177.0.0.1')).toBeNull();
    expect(parseHttpHostAuthority('127.000.000.001')).toBeNull();
    expect(parseHttpHostAuthority('billing.localhost:080')).toBeNull();
    expect(parseHttpHostAuthority(undefined)).toBeNull();
  });
});
