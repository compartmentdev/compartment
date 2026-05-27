import { describe, expect, it } from 'vitest';
import { assertHttpHeaderName, assertHttpHeaderValue, readBearerToken, readHeaderValue } from '../src/http-header';

describe('assertHttpHeaderName', (): void => {
  it('accepts HTTP token header names', (): void => {
    expect((): void => {
      assertHttpHeaderName('X-Compartment_Token', 'header name');
    }).not.toThrow();
  });

  it('rejects empty and separator-containing header names', (): void => {
    expect((): void => {
      assertHttpHeaderName('', 'header name');
    }).toThrow('Invalid header name.');
    expect((): void => {
      assertHttpHeaderName('X Injected', 'header name');
    }).toThrow('Invalid header name.');
    expect((): void => {
      assertHttpHeaderName('X-Injected: value', 'header name');
    }).toThrow('Invalid header name.');
  });

  it('rejects header names with CR, LF, and control characters', (): void => {
    expect((): void => {
      assertHttpHeaderName('X-Injected\rName', 'header name');
    }).toThrow('Invalid header name.');
    expect((): void => {
      assertHttpHeaderName('X-Injected\nName', 'header name');
    }).toThrow('Invalid header name.');
    expect((): void => {
      assertHttpHeaderName('X-Injected\u0001', 'header name');
    }).toThrow('Invalid header name.');
    expect((): void => {
      assertHttpHeaderName('X-Injected\u007f', 'header name');
    }).toThrow('Invalid header name.');
  });
});

describe('assertHttpHeaderValue', (): void => {
  it('accepts visible header values and empty header values', (): void => {
    expect((): void => {
      assertHttpHeaderValue('Bearer session-token', 'authorization header');
    }).not.toThrow();
    expect((): void => {
      assertHttpHeaderValue('', 'optional header');
    }).not.toThrow();
  });

  it('rejects CR, LF, control characters, and DEL without echoing the value', (): void => {
    expect((): void => {
      assertHttpHeaderValue('secret\r\nX-Injected: yes', 'authorization header');
    }).toThrow(/^Invalid authorization header\.$/);
    expect((): void => {
      assertHttpHeaderValue('secret\nX-Injected: yes', 'authorization header');
    }).toThrow(/^Invalid authorization header\.$/);
    expect((): void => {
      assertHttpHeaderValue('secret\tX-Injected: yes', 'authorization header');
    }).toThrow(/^Invalid authorization header\.$/);
    expect((): void => {
      assertHttpHeaderValue('secret\u0001', 'authorization header');
    }).toThrow(/^Invalid authorization header\.$/);
    expect((): void => {
      assertHttpHeaderValue('secret\u007f', 'authorization header');
    }).toThrow(/^Invalid authorization header\.$/);
  });
});

describe('readHeaderValue', (): void => {
  it('returns the first header value when fastify provides an array', (): void => {
    expect(readHeaderValue(['first', 'second'])).toBe('first');
  });

  it('returns the scalar header value unchanged', (): void => {
    expect(readHeaderValue('origin.example.com')).toBe('origin.example.com');
  });

  it('returns undefined when the header is missing', (): void => {
    expect(readHeaderValue(undefined)).toBeUndefined();
  });
});

describe('readBearerToken', (): void => {
  it('returns the bearer token from a scalar header value', (): void => {
    expect(readBearerToken('Bearer session-token')).toBe('session-token');
  });

  it('returns the bearer token from the first array header value', (): void => {
    expect(readBearerToken(['Bearer first-token', 'Bearer second-token'])).toBe('first-token');
  });

  it('returns an empty token when the bearer prefix has no value', (): void => {
    expect(readBearerToken('Bearer ')).toBe('');
  });

  it('returns undefined for a non-bearer authorization header', (): void => {
    expect(readBearerToken('Basic credentials')).toBeUndefined();
  });

  it('returns undefined when the authorization header is missing', (): void => {
    expect(readBearerToken(undefined)).toBeUndefined();
  });
});
