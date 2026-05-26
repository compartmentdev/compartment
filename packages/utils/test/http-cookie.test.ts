import { describe, expect, it } from 'vitest';
import { serializeCookie } from '../src/http-cookie';

describe('serializeCookie', (): void => {
  it('preserves the default serialized cookie attributes', (): void => {
    expect(serializeCookie('session', 'abc123')).toBe('session=abc123; Path=/; HttpOnly');
  });

  it('preserves explicit valid cookie attributes', (): void => {
    expect(
      serializeCookie('session', 'abc123', {
        domain: 'app.example.com',
        expires: new Date('2030-01-02T03:04:05.000Z'),
        httpOnly: true,
        maxAgeSeconds: 60,
        path: '/account',
        sameSite: 'Lax',
        secure: true,
      }),
    ).toBe(
      'session=abc123; Domain=app.example.com; Path=/account; Expires=Wed, 02 Jan 2030 03:04:05 GMT; Max-Age=60; HttpOnly; SameSite=Lax; Secure',
    );
  });

  it('rejects cookie names with invalid separators', (): void => {
    expect((): string => serializeCookie('session; Domain=evil.example.com', 'abc123')).toThrow('Invalid cookie name.');
    expect((): string => serializeCookie('session token', 'abc123')).toThrow('Invalid cookie name.');
    expect((): string => serializeCookie('session=value', 'abc123')).toThrow('Invalid cookie name.');
  });

  it('rejects cookie names with CR, LF, and control characters', (): void => {
    expect((): string => serializeCookie('session\rInjected', 'abc123')).toThrow('Invalid cookie name.');
    expect((): string => serializeCookie('session\nInjected', 'abc123')).toThrow('Invalid cookie name.');
    expect((): string => serializeCookie('session\u0000', 'abc123')).toThrow('Invalid cookie name.');
    expect((): string => serializeCookie('session\u007f', 'abc123')).toThrow('Invalid cookie name.');
  });

  it('rejects cookie values with header or cookie delimiters', (): void => {
    expect((): string => serializeCookie('session', 'abc123; Path=/admin')).toThrow('Invalid cookie value.');
    expect((): string => serializeCookie('session', 'abc123\r\nX-Injected: yes')).toThrow('Invalid cookie value.');
    expect((): string => serializeCookie('session', 'abc123\u0001')).toThrow('Invalid cookie value.');
    expect((): string => serializeCookie('session', 'abc123\u007f')).toThrow('Invalid cookie value.');
  });

  it('rejects injected cookie Domain and Path attributes', (): void => {
    expect((): string => serializeCookie('session', 'abc123', { domain: 'app.example.com; Path=/admin' })).toThrow(
      'Invalid cookie Domain attribute.',
    );
    expect((): string => serializeCookie('session', 'abc123', { domain: 'app.example.com\r\nInjected: yes' })).toThrow(
      'Invalid cookie Domain attribute.',
    );
    expect((): string => serializeCookie('session', 'abc123', { path: '/account; Secure' })).toThrow(
      'Invalid cookie Path attribute.',
    );
    expect((): string => serializeCookie('session', 'abc123', { path: '/account\u0001' })).toThrow(
      'Invalid cookie Path attribute.',
    );
  });

  it('rejects injected generated attributes before joining the Set-Cookie header', (): void => {
    const expires: Date = new Date('2030-01-02T03:04:05.000Z');
    expires.toUTCString = (): string => 'Wed, 02 Jan 2030 03:04:05 GMT\r\nX-Injected: yes';

    expect((): string => serializeCookie('session', 'abc123', { expires })).toThrow(
      'Invalid cookie Expires attribute.',
    );
    expect((): string => serializeCookie('session', 'abc123', { sameSite: 'Lax; Secure' as 'Lax' })).toThrow(
      'Invalid cookie SameSite attribute.',
    );
  });
});
