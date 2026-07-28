import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import { createEdgeStateUpdateFailedError } from '../src/errors/api-business-error';
import type { InsertOperationInput, OperationRecord } from '../src/queries/operations.query.types';
import type { AuthSessionPlan, IssueAuthSessionInput } from '../src/services/auth-session.types';
import { install } from '../src/services/install.service';
import type { InstallResult, InstallServiceInput } from '../src/services/install.service.types';
import type {
  CreateInitialInstallationInput,
  InstallGuardCallback,
  InstallTransaction,
} from '../src/queries/install.query.types';

type HashPassword = (password: string) => Promise<string>;
type GetApiConfig = () => ApiConfig;
type CreateAuthSessionPlan = (input: IssueAuthSessionInput, config: ApiConfig) => AuthSessionPlan;
type WithInitialInstallationGuard = (
  callback: InstallGuardCallback<OperationRecord>,
) => Promise<OperationRecord | null>;
type InsertInitialInstallationWithExecutor = (
  tx: InstallTransaction,
  input: CreateInitialInstallationInput,
  operationInput: InsertOperationInput,
) => Promise<OperationRecord>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;

interface InstallServiceTestMocks {
  createAuthSessionPlan: Mock<CreateAuthSessionPlan>;
  getApiConfig: Mock<GetApiConfig>;
  hash: Mock<HashPassword>;
  insertInitialInstallationWithExecutor: Mock<InsertInitialInstallationWithExecutor>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
  withInitialInstallationGuard: Mock<WithInitialInstallationGuard>;
}

const mocks: InstallServiceTestMocks = vi.hoisted(
  (): InstallServiceTestMocks => ({
    createAuthSessionPlan: vi.fn<CreateAuthSessionPlan>(),
    getApiConfig: vi.fn<GetApiConfig>(),
    hash: vi.fn<HashPassword>(),
    insertInitialInstallationWithExecutor: vi.fn<InsertInitialInstallationWithExecutor>(),
    synchronizeEdgeAppAccessState: vi.fn<SynchronizeEdgeAppAccessState>(),
    withInitialInstallationGuard: vi.fn<WithInitialInstallationGuard>(),
  }),
);

vi.mock('argon2', (): { default: { hash: Mock<HashPassword> } } => ({
  default: {
    hash: mocks.hash,
  },
}));

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

vi.mock('../src/services/auth-session.service', (): { createAuthSessionPlan: Mock<CreateAuthSessionPlan> } => ({
  createAuthSessionPlan: mocks.createAuthSessionPlan,
}));

vi.mock(
  '../src/services/app-access-edge.service',
  (): { synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState> } => ({
    synchronizeEdgeAppAccessState: mocks.synchronizeEdgeAppAccessState,
  }),
);

interface InstallQueryModuleMock {
  insertInitialInstallationWithExecutor: Mock<InsertInitialInstallationWithExecutor>;
  withInitialInstallationGuard: Mock<WithInitialInstallationGuard>;
}

vi.mock(
  '../src/queries/install.query',
  (): InstallQueryModuleMock => ({
    insertInitialInstallationWithExecutor: mocks.insertInitialInstallationWithExecutor,
    withInitialInstallationGuard: mocks.withInitialInstallationGuard,
  }),
);

const installInput: InstallServiceInput = {
  adminEmail: 'admin@example.com',
  adminPassword: 'supersecretpassword',
  baseDomain: 'example.com',
  organizationName: 'Acme Dev',
  organizationSlug: 'acme-dev',
};

const apiConfig: ApiConfig = {
  bindHost: '127.0.0.1',
  baseDomain: 'localhost',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl: 'postgresql://127.0.0.1:5432/compartment_test',
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9080',
  logLevel: 'info',
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
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment/compartment-install-service-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
  runtimeControlToken: 'test-runtime-control-token',
};

const sessionPlan: AuthSessionPlan = {
  authMethodKind: 'password',
  expiresAt: new Date('2026-03-21T12:00:00.000Z'),
  oidcProviderId: null,
  organizationId: 'org_123',
  sessionId: 'ses_123',
  sessionToken: 'session-token',
  tokenHash: 'session-token-hash',
};

const operationRecord: OperationRecord = {
  actorPrincipalId: 'prn_123',
  completedAt: new Date('2026-03-21T12:00:00.000Z'),
  createdAt: new Date('2026-03-21T12:00:00.000Z'),
  id: 'op_123',
  status: 'succeeded',
  summary: 'Installed compartment with organization acme-dev',
  targetId: 'org_123',
  targetType: 'organization',
  type: 'compartment.install',
};

const installTransaction: InstallTransaction = {} as InstallTransaction;

describe('install service', (): void => {
  beforeEach((): void => {
    mocks.getApiConfig.mockReturnValue(apiConfig);
    mocks.createAuthSessionPlan.mockReturnValue(sessionPlan);
    mocks.synchronizeEdgeAppAccessState.mockResolvedValue();
  });

  it('does not hash the password when the install guard rejects initialization', async (): Promise<void> => {
    mocks.withInitialInstallationGuard.mockResolvedValue(null);

    await expect(install(installInput)).rejects.toThrow('The installation has already been initialized.');

    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.insertInitialInstallationWithExecutor).not.toHaveBeenCalled();
    expect(mocks.synchronizeEdgeAppAccessState).not.toHaveBeenCalled();
  });

  it('hashes the password only inside the guarded installation callback', async (): Promise<void> => {
    mocks.withInitialInstallationGuard.mockImplementation(
      async (callback: InstallGuardCallback<OperationRecord>): Promise<OperationRecord> =>
        await callback(installTransaction),
    );
    mocks.hash.mockResolvedValue('password-hash');
    mocks.insertInitialInstallationWithExecutor.mockImplementation(
      async (): Promise<OperationRecord> => await Promise.resolve(operationRecord),
    );

    const result: InstallResult = await install(installInput);

    expect(mocks.hash).toHaveBeenCalledWith('supersecretpassword');
    expect(mocks.insertInitialInstallationWithExecutor).toHaveBeenCalledWith(
      installTransaction,
      expect.objectContaining({
        organizationName: 'Acme Dev',
        organizationSlug: 'acme-dev',
        passwordHash: 'password-hash',
        principalEmail: 'admin@example.com',
        sessionExpiresAt: sessionPlan.expiresAt,
        sessionId: sessionPlan.sessionId,
        sessionTokenHash: sessionPlan.tokenHash,
      }),
      expect.objectContaining({
        status: 'succeeded',
        targetType: 'organization',
        type: 'compartment.install',
      }),
    );
    const insertCall: [InstallTransaction, CreateInitialInstallationInput, InsertOperationInput] = mocks
      .insertInitialInstallationWithExecutor.mock.calls[0] as [
      InstallTransaction,
      CreateInitialInstallationInput,
      InsertOperationInput,
    ];
    const insertedInstallationInput: CreateInitialInstallationInput = insertCall[1];
    expect(insertedInstallationInput.organizationMembershipId).toBeDefined();
    expect(insertedInstallationInput.installationMembershipId).toBeUndefined();
    expect(insertedInstallationInput.membershipId).toBeUndefined();
    expect(result.organizationSlug).toBe('acme-dev');
    expect(result.sessionToken).toBe('session-token');
    expect(mocks.synchronizeEdgeAppAccessState).toHaveBeenCalledTimes(1);
  });

  it('rethrows edge sync failures after initialization commits', async (): Promise<void> => {
    mocks.withInitialInstallationGuard.mockImplementation(
      async (callback: InstallGuardCallback<OperationRecord>): Promise<OperationRecord> =>
        await callback(installTransaction),
    );
    mocks.hash.mockResolvedValue('password-hash');
    mocks.insertInitialInstallationWithExecutor.mockResolvedValue(operationRecord);
    mocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(createEdgeStateUpdateFailedError());

    await expect(install(installInput)).rejects.toThrow('The edge state could not be updated. Retry the operation.');
    expect(mocks.insertInitialInstallationWithExecutor).toHaveBeenCalledTimes(1);
    expect(mocks.synchronizeEdgeAppAccessState).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid base domains with a client-facing error', async (): Promise<void> => {
    await expect(
      install({
        ...installInput,
        baseDomain: 'my env',
      }),
    ).rejects.toThrow('Base domain must be a valid hostname like example.com or localhost.');

    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.insertInitialInstallationWithExecutor).not.toHaveBeenCalled();
    expect(mocks.synchronizeEdgeAppAccessState).not.toHaveBeenCalled();
  });

  it('rejects organization names that do not produce a usable derived slug', async (): Promise<void> => {
    await expect(
      install({
        ...installInput,
        organizationName: '!!!',
        organizationSlug: undefined,
      }),
    ).rejects.toThrow('Organization slug must contain at least one letter or digit.');

    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.insertInitialInstallationWithExecutor).not.toHaveBeenCalled();
    expect(mocks.synchronizeEdgeAppAccessState).not.toHaveBeenCalled();
  });
});
