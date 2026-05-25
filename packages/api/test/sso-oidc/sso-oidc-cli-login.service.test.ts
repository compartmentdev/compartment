import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../../src/config';
import { hashToken } from '../../src/lib/tokens';
import type { CliLoginAttemptExecutor, CliLoginAttemptRow } from '../../src/queries/cli-login.query.types';
import type { OrganizationRow } from '../../src/queries/organizations.query.types';
import {
  completeCliLoginAttemptFromSession,
  exchangeCliLogin,
  getCliLoginStatus,
  startCliLogin,
} from '../../src/services/cli-login.service';
import type { CliLoginExchangeResult, CliLoginStartResult } from '../../src/services/cli-login.service.types';
import type { AuthSessionPlan } from '../../src/services/auth-session.types';
import type { buildAuthSessionOrganizationPolicySession } from '../../src/services/auth-session.service';
import type { AuthSessionOrganizationPolicySession } from '../../src/services/organization-auth-settings.service.types';
import { createSsoOidcApiConfig } from './sso-oidc-login.service.fixtures';

type BuildAuthSessionOrganizationPolicySession = typeof buildAuthSessionOrganizationPolicySession;

interface CliLoginServiceMocks {
  createAuthSessionPlan: Mock;
  createAuthSessionWithExecutor: Mock;
  createCliLoginAttempt: Mock;
  deleteStaleCliLoginAttempts: Mock;
  expireCliLoginAttempt: Mock;
  findCliLoginAttemptById: Mock;
  getApiConfig: Mock;
  getApiDatabase: Mock;
  isAuthSessionAllowedForOrganization: Mock;
  listOrganizationRowsForPrincipalEmail: Mock;
  listSessionVisibleOrganizations: Mock;
  markCliLoginAttemptAuthenticated: Mock;
  markCliLoginAttemptExchangedWithExecutor: Mock;
  readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail: Mock;
}

interface AuthSessionServiceModuleMock {
  buildAuthSessionOrganizationPolicySession: BuildAuthSessionOrganizationPolicySession;
  createAuthSessionPlan: Mock;
}

const transactionExecutor: CliLoginAttemptExecutor = {
  delete: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
};

const mocks: CliLoginServiceMocks = vi.hoisted(
  (): CliLoginServiceMocks => ({
    createAuthSessionPlan: vi.fn(),
    createAuthSessionWithExecutor: vi.fn(),
    createCliLoginAttempt: vi.fn(),
    deleteStaleCliLoginAttempts: vi.fn(),
    expireCliLoginAttempt: vi.fn(),
    findCliLoginAttemptById: vi.fn(),
    getApiConfig: vi.fn(),
    getApiDatabase: vi.fn(),
    isAuthSessionAllowedForOrganization: vi.fn(),
    listOrganizationRowsForPrincipalEmail: vi.fn(),
    listSessionVisibleOrganizations: vi.fn(),
    markCliLoginAttemptAuthenticated: vi.fn(),
    markCliLoginAttemptExchangedWithExecutor: vi.fn(),
    readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail: vi.fn(),
  }),
);

vi.mock(
  '../../src/runtime/runtime-access',
  (): Record<string, Mock> => ({
    getApiConfig: mocks.getApiConfig,
    getApiDatabase: mocks.getApiDatabase,
  }),
);

vi.mock(
  '../../src/queries/organizations.query',
  (): Record<string, Mock> => ({
    listOrganizationRowsForPrincipalEmail: mocks.listOrganizationRowsForPrincipalEmail,
  }),
);

vi.mock(
  '../../src/queries/cli-login.query',
  (): Record<string, Mock> => ({
    createCliLoginAttempt: mocks.createCliLoginAttempt,
    deleteStaleCliLoginAttempts: mocks.deleteStaleCliLoginAttempts,
    expireCliLoginAttempt: mocks.expireCliLoginAttempt,
    findCliLoginAttemptById: mocks.findCliLoginAttemptById,
    markCliLoginAttemptAuthenticated: mocks.markCliLoginAttemptAuthenticated,
    markCliLoginAttemptExchangedWithExecutor: mocks.markCliLoginAttemptExchangedWithExecutor,
  }),
);

vi.mock(
  '../../src/services/auth-session.service',
  (): AuthSessionServiceModuleMock => ({
    buildAuthSessionOrganizationPolicySession: createAuthSessionOrganizationPolicySession,
    createAuthSessionPlan: mocks.createAuthSessionPlan,
  }),
);

vi.mock(
  '../../src/queries/authentication.query',
  (): Record<string, Mock> => ({
    createAuthSessionWithExecutor: mocks.createAuthSessionWithExecutor,
  }),
);

vi.mock(
  '../../src/services/organizations.service',
  (): Record<string, Mock> => ({
    listSessionVisibleOrganizations: mocks.listSessionVisibleOrganizations,
  }),
);

vi.mock(
  '../../src/services/organization-auth-settings.service',
  (): Record<string, Mock> => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
  }),
);

vi.mock(
  '../../src/services/onboarding-first-deploy-correlation.service',
  (): Record<string, Mock> => ({
    readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail:
      mocks.readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail,
  }),
);

describe('CLI login service', (): void => {
  beforeEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
    mocks.getApiConfig.mockReturnValue(createSsoOidcApiConfig());
    mocks.getApiDatabase.mockReturnValue({
      transaction: async (callback: (executor: typeof transactionExecutor) => Promise<void>): Promise<void> => {
        await callback(transactionExecutor);
      },
    });
    mocks.isAuthSessionAllowedForOrganization.mockResolvedValue(true);
  });

  it('creates a short-lived CLI login attempt and returns a fragment-based verification URL', async (): Promise<void> => {
    mocks.listOrganizationRowsForPrincipalEmail.mockResolvedValueOnce([createOrganizationRow()]);

    const result: CliLoginStartResult = await startCliLogin({
      email: 'admin@example.com',
      organizationSlug: 'acme-dev',
    });

    const verificationUrl: URL = new URL(result.verificationUrl);
    expect(mocks.deleteStaleCliLoginAttempts).toHaveBeenCalledWith(expect.any(Date));
    expect(mocks.createCliLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPrincipalEmail: 'admin@example.com',
        organizationId: 'org_123',
      }),
    );
    expect(verificationUrl.pathname).toBe('/login/cli');
    expect(verificationUrl.searchParams.get('attempt')).toBe(result.attemptId);
    expect(verificationUrl.hash).toMatch(/^#code=/);
  });

  it('validates onboarding CLI login correlation for the requested email owner', async (): Promise<void> => {
    mocks.listOrganizationRowsForPrincipalEmail.mockResolvedValueOnce([createOrganizationRow()]);
    mocks.readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail.mockResolvedValueOnce('fdo_123');

    await startCliLogin({
      email: 'admin@example.com',
      onboardingSessionId: 'fdo_123',
      organizationSlug: 'acme-dev',
    });

    expect(mocks.readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail).toHaveBeenCalledWith({
      onboardingSessionId: 'fdo_123',
      organizationId: 'org_123',
      principalEmail: 'admin@example.com',
    });
    expect(mocks.createCliLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingSessionId: 'fdo_123',
      }),
    );
  });

  it('rejects onboarding CLI login correlation when no organization is resolved', async (): Promise<void> => {
    await expect(
      startCliLogin({
        onboardingSessionId: 'fdo_123',
      }),
    ).rejects.toThrow('The first deploy onboarding session was not found.');

    expect(mocks.readValidatedFirstDeployOnboardingSessionIdForPrincipalEmail).not.toHaveBeenCalled();
    expect(mocks.createCliLoginAttempt).not.toHaveBeenCalled();
  });

  it('rejects CLI login status checks with the wrong exchange secret', async (): Promise<void> => {
    mocks.findCliLoginAttemptById.mockResolvedValueOnce(createAttemptRow(createSsoOidcApiConfig(), {}));

    await expect(
      getCliLoginStatus({
        attemptId: 'cla_123',
        exchangeSecret: 'wrong-secret',
      }),
    ).rejects.toThrow('The CLI login attempt is invalid or expired.');
  });

  it('exchanges an authenticated CLI login attempt into a regular auth session', async (): Promise<void> => {
    const config: ApiConfig = createSsoOidcApiConfig();
    const session: AuthSessionPlan = {
      authMethodKind: 'oidc',
      expiresAt: new Date('2099-04-21T10:20:00.000Z'),
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      sessionId: 'ses_123',
      sessionToken: 'session-token',
      tokenHash: 'token-hash',
    };
    mocks.findCliLoginAttemptById.mockResolvedValueOnce(
      createAttemptRow(config, {
        authenticatedAt: new Date('2026-04-21T10:00:00.000Z'),
        authenticatedAuthMethodKind: 'oidc',
        authenticatedOidcProviderId: 'sop_123',
        authenticatedPrincipalId: 'prn_123',
      }),
    );
    mocks.createAuthSessionPlan.mockReturnValueOnce(session);
    mocks.markCliLoginAttemptExchangedWithExecutor.mockResolvedValueOnce(true);
    mocks.listSessionVisibleOrganizations.mockResolvedValueOnce([createOrganizationRow()]);

    const result: CliLoginExchangeResult = await exchangeCliLogin({
      attemptId: 'cla_123',
      exchangeSecret: 'exchange-secret',
    });

    expect(mocks.createAuthSessionWithExecutor).toHaveBeenCalledWith(
      transactionExecutor,
      expect.objectContaining({
        principalId: 'prn_123',
        sessionId: 'ses_123',
        tokenHash: 'token-hash',
      }),
    );
    expect(mocks.listSessionVisibleOrganizations).toHaveBeenCalledWith({
      authMethodKind: 'oidc',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    expect(result).toEqual({
      organizations: [createOrganizationRow()],
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      sessionExpiresAt: new Date('2099-04-21T10:20:00.000Z'),
      sessionId: 'ses_123',
      sessionToken: 'session-token',
    });
  });

  it('rejects browser-session completion when the authenticated principal email does not match the attempt', async (): Promise<void> => {
    mocks.findCliLoginAttemptById.mockResolvedValueOnce(createAttemptRow(createSsoOidcApiConfig(), {}));
    mocks.markCliLoginAttemptAuthenticated.mockResolvedValueOnce(true);

    await expect(
      completeCliLoginAttemptFromSession({
        attemptId: 'cla_123',
        browserCode: 'browser-code',
        session: {
          authMethodKind: 'password',
          oidcProviderId: null,
          organizationId: 'org_123',
          principalEmail: 'other@example.com',
          principalId: 'prn_123',
        },
      }),
    ).rejects.toThrow('The CLI login attempt is invalid or expired.');
    expect(mocks.markCliLoginAttemptAuthenticated).not.toHaveBeenCalled();
  });
});

function createOrganizationRow(): OrganizationRow {
  return {
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}

function createAuthSessionOrganizationPolicySession(
  session: AuthSessionPlan,
  principalId: string,
): AuthSessionOrganizationPolicySession {
  return {
    authMethodKind: session.authMethodKind,
    oidcProviderId: session.oidcProviderId,
    organizationId: session.organizationId,
    principalId,
  };
}

function createAttemptRow(config: ApiConfig, overrides: Partial<CliLoginAttemptRow>): CliLoginAttemptRow {
  return {
    authenticatedAt: overrides.authenticatedAt ?? null,
    authenticatedAuthMethodKind: overrides.authenticatedAuthMethodKind ?? null,
    authenticatedOidcProviderId: overrides.authenticatedOidcProviderId ?? null,
    authenticatedPrincipalId: overrides.authenticatedPrincipalId ?? null,
    browserCodeHash: hashToken('browser-code', config.sessionSecret),
    createdAt: new Date('2026-04-21T10:00:00.000Z'),
    exchangeSecretHash: hashToken('exchange-secret', config.sessionSecret),
    exchangedAt: overrides.exchangedAt ?? null,
    expectedPrincipalEmail: overrides.expectedPrincipalEmail ?? 'admin@example.com',
    expiresAt: overrides.expiresAt ?? new Date('2099-04-21T10:10:00.000Z'),
    id: 'cla_123',
    onboardingSessionId: overrides.onboardingSessionId ?? null,
    organizationId: overrides.organizationId ?? 'org_123',
  };
}
