import type { LoginRequest } from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  readLoginDiscoverySubjectRateLimitKey,
  readScopedAuthRateLimitKey,
} from '../src/routes/auth/auth-rate-limit-keys';
import { buildLoginThrottleIdentity } from '../src/services/auth-throttle-keys.service';

type RateLimitRequestBody = Record<string, boolean | number | string | undefined>;

interface RateLimitRequestFixture {
  body?: RateLimitRequestBody;
  ip: string;
}

describe('auth rate limit keys', (): void => {
  it('normalizes scoped auth rate limit keys by source, email, and organization selector', (): void => {
    const leftKey: string = readScopedAuthRateLimitKey(
      createRateLimitRequest({
        body: {
          email: 'Admin@Example.COM',
          organizationSlug: ' acme-dev ',
        },
        ip: '203.0.113.10',
      }),
    );
    const rightKey: string = readScopedAuthRateLimitKey(
      createRateLimitRequest({
        body: {
          email: 'admin@example.com',
          organizationSlug: 'acme-dev',
        },
        ip: '203.0.113.10',
      }),
    );

    expect(leftKey).toBe(rightKey);
    expect(leftKey).toBe('203.0.113.10|admin@example.com|org:acme-dev');
  });

  it('builds login discovery subject keys without the source IP', (): void => {
    const key: string = readLoginDiscoverySubjectRateLimitKey(
      createRateLimitRequest({
        body: {
          email: 'Admin@Example.COM',
          host: ' Billing.Localhost ',
        },
        ip: '203.0.113.10',
      }),
    );

    expect(key).toBe('admin@example.com|host:billing.localhost');
  });

  it('falls back to the source IP for invalid login discovery subject bodies', (): void => {
    expect(
      readLoginDiscoverySubjectRateLimitKey(
        createRateLimitRequest({
          body: {
            email: 'not-an-email',
          },
          ip: '203.0.113.10',
        }),
      ),
    ).toBe('203.0.113.10');

    expect(
      readLoginDiscoverySubjectRateLimitKey(
        createRateLimitRequest({
          body: {},
          ip: '203.0.113.11',
        }),
      ),
    ).toBe('203.0.113.11');
  });

  it('normalizes organization slug whitespace in login failure identities', (): void => {
    const trimmedRequest: LoginRequest = createLoginRequest({
      organizationSlug: 'acme-dev',
    });
    const spacedRequest: LoginRequest = createLoginRequest({
      organizationSlug: ' acme-dev ',
    });

    expect(buildLoginThrottleIdentity(spacedRequest, '203.0.113.10')).toEqual(
      buildLoginThrottleIdentity(trimmedRequest, '203.0.113.10'),
    );
  });

  it('normalizes host whitespace in login failure identities', (): void => {
    const trimmedRequest: LoginRequest = createLoginRequest({
      host: 'billing.localhost',
    });
    const spacedRequest: LoginRequest = createLoginRequest({
      host: ' billing.localhost ',
    });

    expect(buildLoginThrottleIdentity(spacedRequest, '203.0.113.10')).toEqual(
      buildLoginThrottleIdentity(trimmedRequest, '203.0.113.10'),
    );
  });
});

function createLoginRequest(overrides: Partial<LoginRequest>): LoginRequest {
  return {
    email: 'admin@example.com',
    password: 'supersecretpassword',
    ...overrides,
  };
}

function createRateLimitRequest(input: RateLimitRequestFixture): FastifyRequest {
  return {
    body: input.body,
    ip: input.ip,
  } as FastifyRequest;
}
