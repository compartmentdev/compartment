import { describe, expect, it } from 'vitest';
import { readBearerToken, readHeaderValue } from '../src/http-header';

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
