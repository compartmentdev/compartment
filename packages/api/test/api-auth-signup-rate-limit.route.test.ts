import { randomUUID } from 'node:crypto';
import { compartmentIdempotencyKeyHeaderName } from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { apiRouteRateLimitPolicies } from '../src/http/rate-limit-policies';
import { authApiSignupPathname } from '../src/routes/auth/auth-api-paths';
import type { requireInstalledCompartment } from '../src/services/app-access-target.service';
import type { signUp } from '../src/services/signup.service';
import type { SignupResult } from '../src/services/signup.service.types';
import { applyApiRouteTestEnv, injectJson, withApiRouteApp } from './api-route-test.harness';

type RequireInstalledCompartment = typeof requireInstalledCompartment;
type SignUp = typeof signUp;

interface SignupRateLimitMocks {
  requireInstalledCompartment: Mock<RequireInstalledCompartment>;
  signUp: Mock<SignUp>;
}

const authApiSignupRouteBudget: number = apiRouteRateLimitPolicies.authSignup.max;

const mocks: SignupRateLimitMocks = vi.hoisted(
  (): SignupRateLimitMocks => ({
    requireInstalledCompartment: vi.fn<RequireInstalledCompartment>(),
    signUp: vi.fn<SignUp>(),
  }),
);

vi.mock(
  '../src/services/app-access-target.service',
  (): { requireInstalledCompartment: Mock<RequireInstalledCompartment> } => ({
    requireInstalledCompartment: mocks.requireInstalledCompartment,
  }),
);

vi.mock('../src/services/signup.service', (): { signUp: Mock<SignUp> } => ({
  signUp: mocks.signUp,
}));

describe('api auth signup rate limits', (): void => {
  beforeEach((): void => {
    applyApiRouteTestEnv();
    mocks.signUp.mockResolvedValue(createSignupResult());
  });

  afterEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
  });

  it('stops a source that spends its signup budget from creating more accounts', async (): Promise<void> => {
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      await spendSignupBudget(app, '203.0.113.10');

      const response: LightMyRequestResponse = await injectSignup(app, '203.0.113.10');

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.body).toContain('api_rate_limit_exceeded');
      expect(mocks.signUp).toHaveBeenCalledTimes(authApiSignupRouteBudget);
    });
  });

  it('lets another source keep signing up after one source spends its budget', async (): Promise<void> => {
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      await spendSignupBudget(app, '203.0.113.10');

      const response: LightMyRequestResponse = await injectSignup(app, '203.0.113.11');

      expect(response.statusCode).toBe(200);
      expect(mocks.signUp).toHaveBeenCalledTimes(authApiSignupRouteBudget + 1);
    });
  });
});

function createSignupResult(): SignupResult {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_agent',
    },
    organizations: [{ id: 'org_agent', name: 'Agent Org', slug: 'agent-org' }],
    principalEmail: 'prn_agent@signup.localhost',
    principalId: 'prn_agent',
    sessionExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
    sessionId: 'ses_agent',
    sessionToken: 'signup-session-token',
  };
}

async function spendSignupBudget(app: ApiApp, sourceIp: string): Promise<void> {
  for (let attempt: number = 0; attempt < authApiSignupRouteBudget; attempt += 1) {
    const response: LightMyRequestResponse = await injectSignup(app, sourceIp);

    expect(response.statusCode).toBe(200);
  }
}

async function injectSignup(app: ApiApp, sourceIp: string): Promise<LightMyRequestResponse> {
  return await injectJson(app, {
    headers: {
      [compartmentIdempotencyKeyHeaderName]: randomUUID(),
      'x-forwarded-for': sourceIp,
    },
    method: 'POST',
    payload: { organizationName: 'Agent Org' },
    url: authApiSignupPathname,
  });
}
