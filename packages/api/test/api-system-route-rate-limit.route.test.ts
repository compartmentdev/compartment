import {
  compartmentSystemDomainStatusPathname,
  compartmentSystemIssuePasswordResetPathname,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createSystemApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import { apiRouteRateLimitPolicies } from '../src/http/rate-limit-policies';
import { applyApiRouteTestEnv, expectJsonError, injectApiRoute } from './api-route-test.harness';

interface SystemRateLimitRouteFixture {
  budget: number;
  method: 'GET' | 'POST';
  sourceIp: string;
  url: string;
}

describe('api system route rate limits', (): void => {
  it('rate limits system domain routes through the root rate-limit registration', async (): Promise<void> => {
    applyApiRouteTestEnv();

    await withSystemApiRouteApp(async (app: ApiApp): Promise<void> => {
      await expectSystemRouteRateLimit(app, {
        budget: apiRouteRateLimitPolicies.systemDomain.max,
        method: 'GET',
        sourceIp: '203.0.113.10',
        url: compartmentSystemDomainStatusPathname,
      });
    });
  });

  it('rate limits system password-reset routes through the root rate-limit registration', async (): Promise<void> => {
    applyApiRouteTestEnv();

    await withSystemApiRouteApp(async (app: ApiApp): Promise<void> => {
      await expectSystemRouteRateLimit(app, {
        budget: apiRouteRateLimitPolicies.systemPasswordReset.max,
        method: 'POST',
        sourceIp: '203.0.113.11',
        url: compartmentSystemIssuePasswordResetPathname,
      });
    });
  });
});

async function withSystemApiRouteApp<TResult>(run: (app: ApiApp) => Promise<TResult>): Promise<TResult> {
  const app: ApiApp = createSystemApp();

  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

async function expectSystemRouteRateLimit(app: ApiApp, fixture: SystemRateLimitRouteFixture): Promise<void> {
  for (let attempt: number = 0; attempt < fixture.budget; attempt += 1) {
    const response: LightMyRequestResponse = await injectSystemRoute(app, fixture);

    expectJsonError(response, 401, 'system_api_unauthorized');
  }

  const limitedResponse: LightMyRequestResponse = await injectSystemRoute(app, fixture);

  expectJsonError(limitedResponse, 429, 'api_rate_limit_exceeded');
  expect(limitedResponse.headers['x-ratelimit-limit']).toBe(String(fixture.budget));
  expect(limitedResponse.headers['x-ratelimit-remaining']).toBe('0');
  expect(limitedResponse.headers['x-ratelimit-reset']).toBeDefined();
  expect(limitedResponse.headers['retry-after']).toBeDefined();
}

async function injectSystemRoute(app: ApiApp, fixture: SystemRateLimitRouteFixture): Promise<LightMyRequestResponse> {
  return await injectApiRoute(app, {
    headers: {
      'x-forwarded-for': fixture.sourceIp,
    },
    method: fixture.method,
    url: fixture.url,
  });
}
