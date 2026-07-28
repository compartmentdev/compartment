import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { type ApiConfig } from '../src/config';
import { hashToken } from '../src/lib/tokens';
import type { findAuthenticationSessionByTokenHash } from '../src/queries/authentication.query';
import type { AuthenticationSessionRow } from '../src/queries/authentication.query.types';
import type { getApiConfig } from '../src/runtime/runtime-access';
import { authenticateSession } from '../src/services/authentication.service';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

type FindAuthenticationSessionByTokenHash = typeof findAuthenticationSessionByTokenHash;
type GetApiConfig = typeof getApiConfig;
interface AuthenticationServiceMocks {
  findAuthenticationSessionByTokenHash: Mock<FindAuthenticationSessionByTokenHash>;
  getApiConfig: Mock<GetApiConfig>;
}

const mocks: AuthenticationServiceMocks = vi.hoisted(
  (): AuthenticationServiceMocks => ({
    findAuthenticationSessionByTokenHash: vi.fn<FindAuthenticationSessionByTokenHash>(),
    getApiConfig: vi.fn<GetApiConfig>(),
  }),
);

vi.mock(
  '../src/queries/authentication.query',
  (): { findAuthenticationSessionByTokenHash: Mock<FindAuthenticationSessionByTokenHash> } => ({
    findAuthenticationSessionByTokenHash: mocks.findAuthenticationSessionByTokenHash,
  }),
);

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

describe('authentication service', (): void => {
  afterEach((): void => {
    mocks.findAuthenticationSessionByTokenHash.mockReset();
    mocks.getApiConfig.mockReset();
  });

  it('returns null when no active session matches the hashed token', async (): Promise<void> => {
    const config: ApiConfig = createApiConfig();
    mocks.getApiConfig.mockReturnValue(config);
    mocks.findAuthenticationSessionByTokenHash.mockResolvedValueOnce(undefined);

    await expect(authenticateSession('session-token')).resolves.toBeNull();
    expect(mocks.findAuthenticationSessionByTokenHash).toHaveBeenCalledWith(
      hashToken('session-token', config.sessionSecret),
    );
  });

  it('returns null when the persisted session principal is not a user', async (): Promise<void> => {
    const config: ApiConfig = createApiConfig();
    mocks.getApiConfig.mockReturnValue(config);
    mocks.findAuthenticationSessionByTokenHash.mockResolvedValueOnce({
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalEmail: 'worker@example.com',
      principalId: 'prn_worker',
      principalType: 'worker',
      sessionId: 'ses_worker',
    } satisfies AuthenticationSessionRow);

    await expect(authenticateSession('session-token')).resolves.toBeNull();
  });

  it('returns the authenticated user actor with the hashed token when the session is valid', async (): Promise<void> => {
    const config: ApiConfig = createApiConfig();
    mocks.getApiConfig.mockReturnValue(config);
    mocks.findAuthenticationSessionByTokenHash.mockResolvedValueOnce({
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      principalType: 'user',
      sessionId: 'ses_123',
    } satisfies AuthenticationSessionRow);

    await expect(authenticateSession('session-token')).resolves.toEqual({
      authSession: {
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId: null,
        principalId: 'prn_123',
      },
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      principalType: 'user',
      sessionId: 'ses_123',
      tokenHash: hashToken('session-token', config.sessionSecret),
    });
  });
});

function createApiConfig(): ApiConfig {
  return {
    bindHost: '127.0.0.1',
    baseDomain: 'localhost',
    tlsMode: 'internal',
    controlPlaneHost: 'console.localhost',
    databaseUrl: 'postgresql:///compartment_test?host=/tmp',
    edgeToken: 'test-edge-token',
    edgeUrl: 'http://127.0.0.1:9080',
    logLevel: 'silent',
    port: 9443,
    publicProtocol: 'http',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
    publicHttpPort: 9080,
    publicHttpsPort: 443,
    sessionSecret: 'test-session-secret',
    sessionTtlMs: 604_800_000,
    sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
    sourceArchiveMaxBytes: 104_857_600,
    throttle: defaultApiAuthThrottleConfig,
    systemApiSocketPath: '/tmp/compartment/compartment-authentication-system-api.sock',
    systemToken: 'test-system-token',
    trustedOutboundHosts: [],
    variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
    runtimeControlToken: 'test-runtime-control-token',
  };
}
