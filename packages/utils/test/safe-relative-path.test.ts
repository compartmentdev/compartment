import { describe, expect, it } from 'vitest';
import { isSafeRelativePath, sanitizeSafeRelativePath } from '../src';

describe('safe relative path helpers', (): void => {
  it('accepts same-origin absolute paths', (): void => {
    expect(isSafeRelativePath('/')).toBe(true);
    expect(isSafeRelativePath('/dashboard')).toBe(true);
    expect(isSafeRelativePath('/nested/path?x=1')).toBe(true);
    expect(isSafeRelativePath('/search?q=/../admin')).toBe(true);
    expect(sanitizeSafeRelativePath('/nested/path?x=1')).toBe('/nested/path?x=1');
  });

  it('rejects non-relative and slash-backslash absolute forms', (): void => {
    expect(isSafeRelativePath(undefined)).toBe(false);
    expect(isSafeRelativePath('relative')).toBe(false);
    expect(isSafeRelativePath('//evil.example/path')).toBe(false);
    expect(isSafeRelativePath('/\\evil.example/path')).toBe(false);
    expect(isSafeRelativePath('/app\\admin')).toBe(false);
  });

  it('rejects browser-normalized dot path segments', (): void => {
    expect(isSafeRelativePath('/.')).toBe(false);
    expect(isSafeRelativePath('/./admin')).toBe(false);
    expect(isSafeRelativePath('/app/./admin')).toBe(false);
    expect(isSafeRelativePath('/%2e/_compartment/logout')).toBe(false);
    expect(isSafeRelativePath('/app/%2e/admin')).toBe(false);
    expect(isSafeRelativePath('/..')).toBe(false);
    expect(isSafeRelativePath('/../admin')).toBe(false);
    expect(isSafeRelativePath('/app/../admin')).toBe(false);
    expect(isSafeRelativePath('/..\\admin')).toBe(false);
    expect(isSafeRelativePath('/app\\..\\admin')).toBe(false);
    expect(isSafeRelativePath('/%2e%2e/admin')).toBe(false);
    expect(isSafeRelativePath('/app%5c..%5cadmin')).toBe(false);
    expect(isSafeRelativePath('/app%2f..%2fadmin')).toBe(false);
  });

  it('sanitizes unsafe paths to the root path', (): void => {
    expect(sanitizeSafeRelativePath('relative')).toBe('/');
    expect(sanitizeSafeRelativePath('//evil.example/path')).toBe('/');
    expect(sanitizeSafeRelativePath('/\\evil.example/path')).toBe('/');
    expect(sanitizeSafeRelativePath('/.')).toBe('/');
    expect(sanitizeSafeRelativePath('/../admin')).toBe('/');
    expect(sanitizeSafeRelativePath('/app\\..\\admin')).toBe('/');
    expect(sanitizeSafeRelativePath('/%2e%2e/admin')).toBe('/');
  });
});
