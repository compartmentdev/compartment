import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveCompartmentConsoleAssetDirectory } from '@compartment/console';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { getBrowserAssetPathname } from '../src/browser-public-paths';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import { expectBrowserAntiFramingHeaders } from './browser-route-security-test.helpers';
import { expectNotNoStoreCacheControlHeader } from './response-cache-test.helpers';

const testBrowserAssetPath: string = join(resolveCompartmentConsoleAssetDirectory(), 'browser-security-test.js');

describe('browser assets route', (): void => {
  afterEach((): void => {
    rmSync(testBrowserAssetPath, { force: true });
  });

  it('serves browser assets with anti-framing headers', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mkdirSync(dirname(testBrowserAssetPath), { recursive: true });
    writeFileSync(testBrowserAssetPath, 'console.log("browser-security-test");\n');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        method: 'GET',
        url: getBrowserAssetPathname('browser-security-test.js'),
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('browser-security-test');
      expectNotNoStoreCacheControlHeader(response);
      expectBrowserAntiFramingHeaders(response);
    });
  });
});
