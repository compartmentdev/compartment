import type { AppAccessBrowserFlowTarget, AppAccessExchangeRequest } from '@compartment/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import type { AuthSessionActorRow } from '../src/queries/authentication.query.types';
import { exchangeAppAccessCode, issueAppAccessRedirect } from '../src/services/app-access.service';
import { resolveAppAccessSession } from '../src/services/app-access-session-resolution.service';
import type { AppAccessCodeRow } from '../src/queries/app-access.query.types';
import type {
  consumeAppAccessCode,
  createAppAccessCode,
  createAppAccessSession,
  findActiveAppAccessSessionByTokenHash,
  findResolvedAppAccessSessionByTokenHash,
  findAppAccessCodeByTokenHash,
  revokeAppAccessSession,
} from '../src/queries/app-access.query';
import type { findActiveAuthenticationSessionById } from '../src/queries/authentication.query';
import type {
  buildAppCallbackUrl,
  requireExchangeFlowTarget,
  requireKnownBrowserFlowTarget,
} from '../src/services/app-access-target.service';
import type { isAuthSessionAllowedForOrganization } from '../src/services/organization-auth-settings.service';
import type { canAuthSessionAccessAppRoute } from '../src/services/app-access-authorization.service';
import type { createId, createToken, hashToken } from '../src/lib/tokens';
import type { getApiConfig } from '../src/runtime/runtime';

type BuildAppCallbackUrl = typeof buildAppCallbackUrl;
type CanAuthSessionAccessAppRoute = typeof canAuthSessionAccessAppRoute;
type ConsumeAppAccessCode = typeof consumeAppAccessCode;
type CreateAppAccessCode = typeof createAppAccessCode;
type CreateAppAccessSession = typeof createAppAccessSession;
type CreateId = typeof createId;
type CreateToken = typeof createToken;
type FindActiveAuthenticationSessionById = typeof findActiveAuthenticationSessionById;
type FindActiveAppAccessSessionByTokenHash = typeof findActiveAppAccessSessionByTokenHash;
type FindAppAccessCodeByTokenHash = typeof findAppAccessCodeByTokenHash;
type FindResolvedAppAccessSessionByTokenHash = typeof findResolvedAppAccessSessionByTokenHash;
type GetApiConfig = typeof getApiConfig;
type HashToken = typeof hashToken;
type IsAuthSessionAllowedForOrganization = typeof isAuthSessionAllowedForOrganization;
type RevokeAppAccessSession = typeof revokeAppAccessSession;
type RequireExchangeFlowTarget = typeof requireExchangeFlowTarget;
type RequireKnownBrowserFlowTarget = typeof requireKnownBrowserFlowTarget;

interface AppAccessServiceMocks {
  buildAppCallbackUrl: Mock<BuildAppCallbackUrl>;
  canAuthSessionAccessAppRoute: Mock<CanAuthSessionAccessAppRoute>;
  consumeAppAccessCode: Mock<ConsumeAppAccessCode>;
  createAppAccessCode: Mock<CreateAppAccessCode>;
  createAppAccessSession: Mock<CreateAppAccessSession>;
  createId: Mock<CreateId>;
  createToken: Mock<CreateToken>;
  findActiveAuthenticationSessionById: Mock<FindActiveAuthenticationSessionById>;
  findActiveAppAccessSessionByTokenHash: Mock<FindActiveAppAccessSessionByTokenHash>;
  findAppAccessCodeByTokenHash: Mock<FindAppAccessCodeByTokenHash>;
  findResolvedAppAccessSessionByTokenHash: Mock<FindResolvedAppAccessSessionByTokenHash>;
  getApiConfig: Mock<GetApiConfig>;
  hashToken: Mock<HashToken>;
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
  requireExchangeFlowTarget: Mock<RequireExchangeFlowTarget>;
  requireKnownBrowserFlowTarget: Mock<RequireKnownBrowserFlowTarget>;
  revokeAppAccessSession: Mock<RevokeAppAccessSession>;
}

interface AppAccessQueryMockModule {
  consumeAppAccessCode: Mock<ConsumeAppAccessCode>;
  createAppAccessCode: Mock<CreateAppAccessCode>;
  createAppAccessSession: Mock<CreateAppAccessSession>;
  findActiveAppAccessSessionByTokenHash: Mock<FindActiveAppAccessSessionByTokenHash>;
  findAppAccessCodeByTokenHash: Mock<FindAppAccessCodeByTokenHash>;
  findResolvedAppAccessSessionByTokenHash: Mock<FindResolvedAppAccessSessionByTokenHash>;
  revokeAppAccessSession: Mock<RevokeAppAccessSession>;
}

interface AuthenticationQueryMockModule {
  findActiveAuthenticationSessionById: Mock<FindActiveAuthenticationSessionById>;
}

interface AppAccessTargetServiceMockModule {
  buildAppCallbackUrl: Mock<BuildAppCallbackUrl>;
  requireExchangeFlowTarget: Mock<RequireExchangeFlowTarget>;
  requireKnownBrowserFlowTarget: Mock<RequireKnownBrowserFlowTarget>;
}

interface OrganizationAuthSettingsServiceMockModule {
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
}

interface AppAccessAuthorizationServiceMockModule {
  canAuthSessionAccessAppRoute: Mock<CanAuthSessionAccessAppRoute>;
}

interface TokensMockModule {
  createId: Mock<CreateId>;
  createToken: Mock<CreateToken>;
  hashToken: Mock<HashToken>;
}

interface RuntimeMockModule {
  getApiConfig: Mock<GetApiConfig>;
}

interface AuthenticationServiceMockModule {
  authenticateSession: Mock<() => Promise<null>>;
}

const mocks: AppAccessServiceMocks = vi.hoisted(
  (): AppAccessServiceMocks => ({
    buildAppCallbackUrl: vi.fn<BuildAppCallbackUrl>(),
    canAuthSessionAccessAppRoute: vi.fn<CanAuthSessionAccessAppRoute>(),
    consumeAppAccessCode: vi.fn<ConsumeAppAccessCode>(),
    createAppAccessCode: vi.fn<CreateAppAccessCode>(),
    createAppAccessSession: vi.fn<CreateAppAccessSession>(),
    createId: vi.fn<CreateId>(),
    createToken: vi.fn<CreateToken>(),
    findActiveAuthenticationSessionById: vi.fn<FindActiveAuthenticationSessionById>(),
    findActiveAppAccessSessionByTokenHash: vi.fn<FindActiveAppAccessSessionByTokenHash>(),
    findAppAccessCodeByTokenHash: vi.fn<FindAppAccessCodeByTokenHash>(),
    findResolvedAppAccessSessionByTokenHash: vi.fn<FindResolvedAppAccessSessionByTokenHash>(),
    getApiConfig: vi.fn<GetApiConfig>(),
    hashToken: vi.fn<HashToken>(),
    isAuthSessionAllowedForOrganization: vi.fn<IsAuthSessionAllowedForOrganization>(),
    requireExchangeFlowTarget: vi.fn<RequireExchangeFlowTarget>(),
    requireKnownBrowserFlowTarget: vi.fn<RequireKnownBrowserFlowTarget>(),
    revokeAppAccessSession: vi.fn<RevokeAppAccessSession>(),
  }),
);

vi.mock(
  '../src/queries/app-access.query',
  (): AppAccessQueryMockModule => ({
    consumeAppAccessCode: mocks.consumeAppAccessCode,
    createAppAccessCode: mocks.createAppAccessCode,
    createAppAccessSession: mocks.createAppAccessSession,
    findActiveAppAccessSessionByTokenHash: mocks.findActiveAppAccessSessionByTokenHash,
    findAppAccessCodeByTokenHash: mocks.findAppAccessCodeByTokenHash,
    findResolvedAppAccessSessionByTokenHash: mocks.findResolvedAppAccessSessionByTokenHash,
    revokeAppAccessSession: mocks.revokeAppAccessSession,
  }),
);

vi.mock(
  '../src/queries/authentication.query',
  (): AuthenticationQueryMockModule => ({
    findActiveAuthenticationSessionById: mocks.findActiveAuthenticationSessionById,
  }),
);

vi.mock(
  '../src/services/app-access-target.service',
  (): AppAccessTargetServiceMockModule => ({
    buildAppCallbackUrl: mocks.buildAppCallbackUrl,
    requireExchangeFlowTarget: mocks.requireExchangeFlowTarget,
    requireKnownBrowserFlowTarget: mocks.requireKnownBrowserFlowTarget,
  }),
);

vi.mock(
  '../src/services/organization-auth-settings.service',
  (): OrganizationAuthSettingsServiceMockModule => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
  }),
);

vi.mock(
  '../src/services/app-access-authorization.service',
  (): AppAccessAuthorizationServiceMockModule => ({
    canAuthSessionAccessAppRoute: mocks.canAuthSessionAccessAppRoute,
  }),
);

vi.mock(
  '../src/lib/tokens',
  (): TokensMockModule => ({
    createId: mocks.createId,
    createToken: mocks.createToken,
    hashToken: mocks.hashToken,
  }),
);

vi.mock(
  '../src/runtime/runtime',
  (): RuntimeMockModule => ({
    getApiConfig: mocks.getApiConfig,
  }),
);

vi.mock(
  '../src/services/authentication.service',
  (): AuthenticationServiceMockModule => ({
    authenticateSession: vi.fn(),
  }),
);

const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl: 'postgresql://127.0.0.1:5432/compartment_test',
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  signupEnabled: false,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment/compartment-app-access-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  tenantSecretsKek: Buffer.from('11'.repeat(32), 'hex'),
  variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  runtimeControlToken: 'test-runtime-control-token',
};

describe('app access service', (): void => {
  beforeEach((): void => {
    mocks.getApiConfig.mockReturnValue(apiConfig);
    mocks.buildAppCallbackUrl.mockReturnValue(
      'http://billing.localhost/_compartment/callback?code=code-token&state=flow',
    );
    mocks.canAuthSessionAccessAppRoute.mockResolvedValue(true);
    mocks.hashToken.mockImplementation((value: string): string => `hashed:${value}`);
    mocks.requireExchangeFlowTarget.mockImplementation(echoExchangeFlowTarget);
    mocks.requireKnownBrowserFlowTarget.mockImplementation(echoBrowserFlowTarget);
    mocks.findAppAccessCodeByTokenHash.mockResolvedValue(createAppAccessCodeRow());
    mocks.findActiveAuthenticationSessionById.mockResolvedValue(createAuthSessionActorRow());
    mocks.findActiveAppAccessSessionByTokenHash.mockResolvedValue(undefined);
    mocks.findResolvedAppAccessSessionByTokenHash.mockResolvedValue(undefined);
    mocks.isAuthSessionAllowedForOrganization.mockResolvedValue(true);
    mocks.consumeAppAccessCode.mockResolvedValue(true);
    mocks.createId.mockImplementation((prefix: string): string => `${prefix}_123`);
    mocks.createToken.mockReturnValue('app-session-token');
    mocks.createAppAccessCode.mockResolvedValue();
    mocks.createAppAccessSession.mockResolvedValue();
    mocks.revokeAppAccessSession.mockResolvedValue();
  });

  it('rejects the exchange when the one-time code is missing', async (): Promise<void> => {
    mocks.findAppAccessCodeByTokenHash.mockResolvedValueOnce(undefined);

    await expect(
      exchangeAppAccessCode({
        code: 'missing-code',
        host: 'billing.localhost',
        state: 'flow',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_app_access_code',
    });

    expect(mocks.consumeAppAccessCode).not.toHaveBeenCalled();
    expect(mocks.createAppAccessSession).not.toHaveBeenCalled();
  });

  it('does not create an app access code when the auth session cannot access the app route', async (): Promise<void> => {
    mocks.canAuthSessionAccessAppRoute.mockResolvedValueOnce(false);

    await expect(
      issueAppAccessRedirect({
        authSessionId: 'ses_123',
        host: 'billing.localhost',
        redirectPath: '/dashboard',
        state: 'flow',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_app_access_code',
    });

    expect(mocks.createAppAccessCode).not.toHaveBeenCalled();
  });

  it('does not create an app access session when the auth session cannot access the app route', async (): Promise<void> => {
    mocks.canAuthSessionAccessAppRoute.mockResolvedValueOnce(false);

    await expect(
      exchangeAppAccessCode({
        code: 'one-time-code',
        host: 'billing.localhost',
        state: 'flow',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_app_access_code',
    });

    expect(mocks.consumeAppAccessCode).not.toHaveBeenCalled();
    expect(mocks.createAppAccessSession).not.toHaveBeenCalled();
  });

  it('resolves a PostgreSQL-backed app session for another edge replica', async (): Promise<void> => {
    mocks.findResolvedAppAccessSessionByTokenHash.mockResolvedValueOnce({
      authSessionId: 'ses_123',
      expiresAt: new Date('2099-03-31T00:00:00.000Z'),
      host: 'billing.localhost',
    });

    await expect(resolveAppAccessSession('app-session-token')).resolves.toEqual({
      authSessionId: 'ses_123',
      expiresAt: '2099-03-31T00:00:00.000Z',
      host: 'billing.localhost',
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      principalType: 'user',
    });
  });
});

function createAppAccessCodeRow(): AppAccessCodeRow {
  return {
    authSessionId: 'ses_123',
    consumedAt: null,
    createdAt: new Date('2026-03-24T00:00:00.000Z'),
    expiresAt: new Date('2099-03-31T00:00:00.000Z'),
    host: 'billing.localhost',
    id: 'aac_123',
    redirectPath: '/dashboard',
    state: 'flow',
    tokenHash: 'hashed:one-time-code',
  };
}

function createAuthSessionActorRow(overrides: Partial<AuthSessionActorRow> = {}): AuthSessionActorRow {
  return {
    authMethodKind: 'password',
    expiresAt: new Date('2099-03-31T00:00:00.000Z'),
    oidcProviderId: null,
    organizationId: 'org_123',
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    principalType: 'user',
    sessionId: 'ses_123',
    ...overrides,
  };
}

async function echoExchangeFlowTarget(input: AppAccessExchangeRequest): Promise<AppAccessExchangeRequest> {
  return await Promise.resolve(input);
}

async function echoBrowserFlowTarget(input: AppAccessBrowserFlowTarget): Promise<AppAccessBrowserFlowTarget> {
  return await Promise.resolve(input);
}
