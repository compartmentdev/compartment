import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

const noStoreCacheControlDirective: string = 'no-store';

type CacheControlHeaderValue = string | string[] | undefined;

export function expectNoStoreCacheControlHeader(response: LightMyRequestResponse): void {
  expect(readCacheControlDirectives(response.headers['cache-control'])).toContain(noStoreCacheControlDirective);
}

export function expectNotNoStoreCacheControlHeader(response: LightMyRequestResponse): void {
  expect(readCacheControlDirectives(response.headers['cache-control'])).not.toContain(noStoreCacheControlDirective);
}

function readCacheControlDirectives(header: CacheControlHeaderValue): string[] {
  const headerValues: string[] = readCacheControlHeaderValues(header);

  return headerValues.flatMap((headerValue: string): string[] =>
    headerValue
      .split(',')
      .map((directive: string): string => directive.trim().toLowerCase())
      .filter(Boolean),
  );
}

function readCacheControlHeaderValues(header: CacheControlHeaderValue): string[] {
  if (header === undefined) {
    return [];
  }

  if (Array.isArray(header)) {
    return header;
  }

  return [header];
}
