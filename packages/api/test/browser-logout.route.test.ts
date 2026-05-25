import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { browserLoginPathname, browserLogoutPathname } from '../src/browser-public-paths';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import { expectBrowserAntiFramingHeaders } from './browser-route-security-test.helpers';
import { expectNoStoreCacheControlHeader } from './response-cache-test.helpers';

describe('browser logout route', (): void => {
  it('redirects to the non-mutating login screen with anti-framing headers', async (): Promise<void> => {
    applyApiRouteTestEnv();
    const browserLogoutLandingPathname: string = `${browserLoginPathname}?autoRedirect=false`;

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: browserLogoutPathname,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(browserLogoutLandingPathname);
      expect(response.headers['set-cookie']).toBeUndefined();
      expectNoStoreCacheControlHeader(response);
      expectBrowserAntiFramingHeaders(response);
    });
  });
});
