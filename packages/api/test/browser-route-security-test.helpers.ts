import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import {
  browserAntiFramingContentSecurityPolicy,
  browserAntiFramingFrameOptions,
} from '../src/routes/browser/browser-anti-framing.headers';

export function expectBrowserAntiFramingHeaders(response: LightMyRequestResponse): void {
  expect(response.headers['content-security-policy']).toBe(browserAntiFramingContentSecurityPolicy);
  expect(response.headers['x-frame-options']).toBe(browserAntiFramingFrameOptions);
}
