import type { JsonValue } from '@compartment/utils';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { apiRouteRateLimitPolicies } from '../src/http/rate-limit-policies';
import { authApiLoginDiscoveryPathname } from '../src/routes/auth/auth-api-paths';
import type { requireInstalledCompartment } from '../src/services/app-access-target.service';
import type {
  discoverBrowserLoginState,
  readInitialBrowserLoginState,
  readTrustedInitialBrowserLoginState,
} from '../src/services/browser-login-flow.service';
import { applyApiRouteTestEnv, injectJson, withApiRouteApp } from './api-route-test.harness';

type DiscoverBrowserLoginState = typeof discoverBrowserLoginState;
type ReadInitialBrowserLoginState = typeof readInitialBrowserLoginState;
type ReadTrustedInitialBrowserLoginState = typeof readTrustedInitialBrowserLoginState;
type RequireInstalledCompartment = typeof requireInstalledCompartment;

interface LoginDiscoveryRateLimitMocks {
  discoverBrowserLoginState: Mock<DiscoverBrowserLoginState>;
  readInitialBrowserLoginState: Mock<ReadInitialBrowserLoginState>;
  readTrustedInitialBrowserLoginState: Mock<ReadTrustedInitialBrowserLoginState>;
  requireInstalledCompartment: Mock<RequireInstalledCompartment>;
}

interface LoginDiscoveryPayload {
  email: string;
  organizationSlug?: string | undefined;
}

const authApiDiscoveryRouteBudget: number = apiRouteRateLimitPolicies.authLoginDiscoverySource.max;
const authApiDiscoverySubjectRouteBudget: number = apiRouteRateLimitPolicies.authLoginDiscoverySubject.max;

const mocks: LoginDiscoveryRateLimitMocks = vi.hoisted(
  (): LoginDiscoveryRateLimitMocks => ({
    discoverBrowserLoginState: vi.fn<DiscoverBrowserLoginState>(),
    readInitialBrowserLoginState: vi.fn<ReadInitialBrowserLoginState>(),
    readTrustedInitialBrowserLoginState: vi.fn<ReadTrustedInitialBrowserLoginState>(),
    requireInstalledCompartment: vi.fn<RequireInstalledCompartment>(),
  }),
);

vi.mock(
  '../src/services/app-access-target.service',
  (): { requireInstalledCompartment: Mock<RequireInstalledCompartment> } => ({
    requireInstalledCompartment: mocks.requireInstalledCompartment,
  }),
);

vi.mock(
  '../src/services/browser-login-flow.service',
  (): {
    discoverBrowserLoginState: Mock<DiscoverBrowserLoginState>;
    readInitialBrowserLoginState: Mock<ReadInitialBrowserLoginState>;
    readTrustedInitialBrowserLoginState: Mock<ReadTrustedInitialBrowserLoginState>;
  } => ({
    discoverBrowserLoginState: mocks.discoverBrowserLoginState,
    readInitialBrowserLoginState: mocks.readInitialBrowserLoginState,
    readTrustedInitialBrowserLoginState: mocks.readTrustedInitialBrowserLoginState,
  }),
);

describe('api auth login discovery rate limits', (): void => {
  afterEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
  });

  it('rate limits another discovery email from the same forwarded IP after one email spends its source budget', async (): Promise<void> => {
    applyLoginDiscoveryRouteTestEnv();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      await spendLoginDiscoverySourceBudget(app, '203.0.113.10', { email: 'attacker@example.com' });
      const response: LightMyRequestResponse = await injectLoginDiscovery(app, '203.0.113.10', {
        email: 'victim@example.com',
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers['x-ratelimit-limit']).toBe(String(authApiDiscoveryRouteBudget));
      expect(response.headers['x-ratelimit-remaining']).toBe('0');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.body).toContain('api_rate_limit_exceeded');
      expect(mocks.discoverBrowserLoginState).toHaveBeenCalledTimes(authApiDiscoveryRouteBudget);
    });
  });

  it('rate limits another discovery organization from the same forwarded IP after one organization spends its source budget', async (): Promise<void> => {
    applyLoginDiscoveryRouteTestEnv();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      await spendLoginDiscoverySourceBudget(app, '203.0.113.10', {
        email: 'admin@example.com',
        organizationSlug: 'acme-dev',
      });
      const response: LightMyRequestResponse = await injectLoginDiscovery(app, '203.0.113.10', {
        email: 'admin@example.com',
        organizationSlug: 'acme-ops',
      });

      expect(response.statusCode).toBe(429);
      expect(response.body).toContain('api_rate_limit_exceeded');
      expect(mocks.discoverBrowserLoginState).toHaveBeenCalledTimes(authApiDiscoveryRouteBudget);
    });
  });

  it('lets a different forwarded IP continue after one login discovery source spends its budget', async (): Promise<void> => {
    applyLoginDiscoveryRouteTestEnv();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      await spendLoginDiscoverySourceBudget(app, '203.0.113.10', { email: 'admin@example.com' });
      const response: LightMyRequestResponse = await injectLoginDiscovery(app, '203.0.113.11', {
        email: 'admin@example.com',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe(String(authApiDiscoveryRouteBudget));
      expect(response.headers['x-ratelimit-remaining']).toBe(String(authApiDiscoveryRouteBudget - 1));
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
      expect(mocks.discoverBrowserLoginState).toHaveBeenCalledTimes(authApiDiscoveryRouteBudget + 1);
    });
  });

  it('rate limits one login discovery subject across different forwarded IPs', async (): Promise<void> => {
    applyLoginDiscoveryRouteTestEnv();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let attempt: number = 0; attempt < authApiDiscoverySubjectRouteBudget; attempt += 1) {
        const response: LightMyRequestResponse = await injectLoginDiscovery(app, `203.0.113.${attempt + 1}`, {
          email: 'admin@example.com',
          organizationSlug: 'acme-dev',
        });

        expect(response.statusCode).toBe(200);
      }

      const response: LightMyRequestResponse = await injectLoginDiscovery(app, '203.0.113.200', {
        email: 'admin@example.com',
        organizationSlug: 'acme-dev',
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers['x-ratelimit-limit']).toBe(String(authApiDiscoverySubjectRouteBudget));
      expect(response.headers['x-ratelimit-remaining']).toBe('0');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.body).toContain('api_rate_limit_exceeded');
      expect(mocks.discoverBrowserLoginState).toHaveBeenCalledTimes(authApiDiscoverySubjectRouteBudget);
    });
  });
});

function applyLoginDiscoveryRouteTestEnv(): void {
  applyApiRouteTestEnv();
  mocks.discoverBrowserLoginState.mockResolvedValue({
    email: 'admin@example.com',
    flowTarget: null,
    kind: 'methods',
    localPasswordEnabled: true,
    organizationSlug: 'acme-dev',
    ssoOptions: [],
  });
}

async function spendLoginDiscoverySourceBudget(
  app: ApiApp,
  sourceIp: string,
  payload: LoginDiscoveryPayload,
): Promise<void> {
  for (let attempt: number = 0; attempt < authApiDiscoveryRouteBudget; attempt += 1) {
    const response: LightMyRequestResponse = await injectLoginDiscovery(app, sourceIp, payload);

    expect(response.statusCode).toBe(200);
  }
}

async function injectLoginDiscovery(
  app: ApiApp,
  sourceIp: string,
  payload: LoginDiscoveryPayload,
): Promise<LightMyRequestResponse> {
  const jsonPayload: Record<string, JsonValue> = {
    email: payload.email,
  };
  if (payload.organizationSlug !== undefined) {
    jsonPayload.organizationSlug = payload.organizationSlug;
  }

  return await injectJson(app, {
    headers: {
      'x-forwarded-for': sourceIp,
    },
    method: 'POST',
    payload: jsonPayload,
    url: authApiLoginDiscoveryPathname,
  });
}
