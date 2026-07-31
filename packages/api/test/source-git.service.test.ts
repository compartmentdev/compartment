import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type {
  SourceBindingBranchMappingRow,
  SourceBindingRow,
  SourceMutationTransaction,
  SourceRow,
  SourceWriteExecutor,
  UpdateSourceToActiveInput,
} from '../src/queries/source.query.types';
import type { ApiConfig } from '../src/config';
import type {
  ConnectGitSourceInput,
  DisconnectGitSourceInput,
} from '../src/services/git-source/git-source.service.types';
import type { getApiConfig, getApiDatabase } from '../src/runtime/runtime-access';
import type {
  assertGitHubRepositoryBranchExists,
  readGitHubRepositoryMetadata,
  resolveGitHubRepositoryInstallation,
} from '../src/services/git-source/github-app-client.adapter';
import type { persistConnectedGitSource } from '../src/services/git-source/git-source-connect.persistence';
import type { includeGitSourceDescriptorWithinTransaction } from '../src/services/git-source/git-source-exclusion.service';
import type {
  queueGitSourceSyncTaskForConnect,
  readOrCreateGitSourceSyncTaskIdForInclude,
  readOrCreateGitSourceSyncTaskIdForStart,
} from '../src/services/git-source/git-source-sync-task.service';
import type { requireGitProviderAccessByRegistrationId } from '../src/services/git-source/git-source-provider-access.service';
import type { GitProviderAccess } from '../src/services/git-source/git-source-provider.types';
import type { listSourceExcludedDescriptorsBySourceIds } from '../src/queries/source-exclusion.query';
import type {
  findActiveSourceByRepository,
  findConnectedSourceById,
  listActiveBindingsBySourceIds,
  listBranchMappingsByBindingIds,
  updateSourceProviderWebhookId,
  updateSourceToActive,
} from '../src/queries/source.query';
import type {
  findLatestSourceSyncTaskBySourceIdWithExecutor,
  listSourceSyncTaskCandidatesByTaskIdWithExecutor,
} from '../src/queries/source-sync.query';
import { connectGitSource, readGitSource } from '../src/services/git-source/git-source.service';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

type AssertGitHubRepositoryBranchExists = typeof assertGitHubRepositoryBranchExists;
type ReadGitHubRepositoryMetadata = typeof readGitHubRepositoryMetadata;
type ResolveGitHubRepositoryInstallation = typeof resolveGitHubRepositoryInstallation;
type PersistConnectedGitSource = typeof persistConnectedGitSource;
type IncludeGitSourceDescriptorWithinTransaction = typeof includeGitSourceDescriptorWithinTransaction;
type QueueGitSourceSyncTaskForConnect = typeof queueGitSourceSyncTaskForConnect;
type ReadOrCreateGitSourceSyncTaskIdForInclude = typeof readOrCreateGitSourceSyncTaskIdForInclude;
type ReadOrCreateGitSourceSyncTaskIdForStart = typeof readOrCreateGitSourceSyncTaskIdForStart;
type ListSourceExcludedDescriptorsBySourceIds = typeof listSourceExcludedDescriptorsBySourceIds;
type FindActiveSourceByRepository = typeof findActiveSourceByRepository;
type FindConnectedSourceById = typeof findConnectedSourceById;
type ListActiveBindingsBySourceIds = typeof listActiveBindingsBySourceIds;
type ListBranchMappingsByBindingIds = typeof listBranchMappingsByBindingIds;
type UpdateSourceToActive = typeof updateSourceToActive;
type UpdateSourceProviderWebhookId = typeof updateSourceProviderWebhookId;
type FindLatestSourceSyncTaskBySourceIdWithExecutor = typeof findLatestSourceSyncTaskBySourceIdWithExecutor;
type ListSourceSyncTaskCandidatesByTaskIdWithExecutor = typeof listSourceSyncTaskCandidatesByTaskIdWithExecutor;
type GetApiConfig = typeof getApiConfig;
type GetApiDatabase = typeof getApiDatabase;
type TestSourceStatus = 'active' | 'disabled' | 'disconnected';

interface SourceGitServiceMocks {
  assertGitHubRepositoryBranchExists: Mock<AssertGitHubRepositoryBranchExists>;
  requireGitProviderAccessByRegistrationId: Mock<typeof requireGitProviderAccessByRegistrationId>;
  findActiveSourceByRepository: Mock<FindActiveSourceByRepository>;
  findConnectedSourceById: Mock<FindConnectedSourceById>;
  findLatestSourceSyncTaskBySourceIdWithExecutor: Mock<FindLatestSourceSyncTaskBySourceIdWithExecutor>;
  getApiConfig: Mock<GetApiConfig>;
  getApiDatabase: Mock<GetApiDatabase>;
  includeGitSourceDescriptorWithinTransaction: Mock<IncludeGitSourceDescriptorWithinTransaction>;
  listActiveBindingsBySourceIds: Mock<ListActiveBindingsBySourceIds>;
  listBranchMappingsByBindingIds: Mock<ListBranchMappingsByBindingIds>;
  listSourceExcludedDescriptorsBySourceIds: Mock<ListSourceExcludedDescriptorsBySourceIds>;
  listSourceSyncTaskCandidatesByTaskIdWithExecutor: Mock<ListSourceSyncTaskCandidatesByTaskIdWithExecutor>;
  persistConnectedGitSource: Mock<PersistConnectedGitSource>;
  queueGitSourceSyncTaskForConnect: Mock<QueueGitSourceSyncTaskForConnect>;
  readGitHubRepositoryMetadata: Mock<ReadGitHubRepositoryMetadata>;
  readOrCreateGitSourceSyncTaskIdForInclude: Mock<ReadOrCreateGitSourceSyncTaskIdForInclude>;
  readOrCreateGitSourceSyncTaskIdForStart: Mock<ReadOrCreateGitSourceSyncTaskIdForStart>;
  resolveGitHubRepositoryInstallation: Mock<ResolveGitHubRepositoryInstallation>;
  updateSourceToActive: Mock<UpdateSourceToActive>;
  updateSourceProviderWebhookId: Mock<UpdateSourceProviderWebhookId>;
}

interface SourceRowOverrides {
  autoAdoptNewApps?: boolean | undefined;
  defaultAutoDeployEnabled?: boolean | undefined;
  defaultEnvironmentName?: string | undefined;
  syncBranchName?: string | undefined;
}

const mocks: SourceGitServiceMocks = vi.hoisted(
  (): SourceGitServiceMocks => ({
    assertGitHubRepositoryBranchExists: vi.fn<AssertGitHubRepositoryBranchExists>(),
    requireGitProviderAccessByRegistrationId: vi.fn<typeof requireGitProviderAccessByRegistrationId>(),
    findActiveSourceByRepository: vi.fn<FindActiveSourceByRepository>(),
    findConnectedSourceById: vi.fn<FindConnectedSourceById>(),
    findLatestSourceSyncTaskBySourceIdWithExecutor: vi.fn<FindLatestSourceSyncTaskBySourceIdWithExecutor>(),
    getApiConfig: vi.fn<GetApiConfig>(),
    getApiDatabase: vi.fn<GetApiDatabase>(),
    includeGitSourceDescriptorWithinTransaction: vi.fn<IncludeGitSourceDescriptorWithinTransaction>(),
    listActiveBindingsBySourceIds: vi.fn<ListActiveBindingsBySourceIds>(),
    listBranchMappingsByBindingIds: vi.fn<ListBranchMappingsByBindingIds>(),
    listSourceExcludedDescriptorsBySourceIds: vi.fn<ListSourceExcludedDescriptorsBySourceIds>(),
    listSourceSyncTaskCandidatesByTaskIdWithExecutor: vi.fn<ListSourceSyncTaskCandidatesByTaskIdWithExecutor>(),
    persistConnectedGitSource: vi.fn<PersistConnectedGitSource>(),
    queueGitSourceSyncTaskForConnect: vi.fn<QueueGitSourceSyncTaskForConnect>(),
    readGitHubRepositoryMetadata: vi.fn<ReadGitHubRepositoryMetadata>(),
    readOrCreateGitSourceSyncTaskIdForInclude: vi.fn<ReadOrCreateGitSourceSyncTaskIdForInclude>(),
    readOrCreateGitSourceSyncTaskIdForStart: vi.fn<ReadOrCreateGitSourceSyncTaskIdForStart>(),
    resolveGitHubRepositoryInstallation: vi.fn<ResolveGitHubRepositoryInstallation>(),
    updateSourceToActive: vi.fn<UpdateSourceToActive>(),
    updateSourceProviderWebhookId: vi.fn<UpdateSourceProviderWebhookId>(),
  }),
);

vi.mock(
  '../src/services/git-source/git-source-provider-access.service',
  (): {
    requireGitProviderAccessByRegistrationId: Mock<typeof requireGitProviderAccessByRegistrationId>;
  } => ({
    requireGitProviderAccessByRegistrationId: mocks.requireGitProviderAccessByRegistrationId,
  }),
);

vi.mock(
  '../src/queries/source.query',
  (): {
    findActiveSourceByRepository: Mock<FindActiveSourceByRepository>;
    findConnectedSourceById: Mock<FindConnectedSourceById>;
    listActiveBindingsBySourceIds: Mock<ListActiveBindingsBySourceIds>;
    listBranchMappingsByBindingIds: Mock<ListBranchMappingsByBindingIds>;
    updateSourceToActive: Mock<UpdateSourceToActive>;
    updateSourceProviderWebhookId: Mock<UpdateSourceProviderWebhookId>;
  } => ({
    findActiveSourceByRepository: mocks.findActiveSourceByRepository,
    findConnectedSourceById: mocks.findConnectedSourceById,
    listActiveBindingsBySourceIds: mocks.listActiveBindingsBySourceIds,
    listBranchMappingsByBindingIds: mocks.listBranchMappingsByBindingIds,
    updateSourceToActive: mocks.updateSourceToActive,
    updateSourceProviderWebhookId: mocks.updateSourceProviderWebhookId,
  }),
);

vi.mock(
  '../src/queries/source-exclusion.query',
  (): {
    listSourceExcludedDescriptorsBySourceIds: Mock<ListSourceExcludedDescriptorsBySourceIds>;
  } => ({
    listSourceExcludedDescriptorsBySourceIds: mocks.listSourceExcludedDescriptorsBySourceIds,
  }),
);

vi.mock(
  '../src/queries/source-sync.query',
  (): {
    findLatestSourceSyncTaskBySourceIdWithExecutor: Mock<FindLatestSourceSyncTaskBySourceIdWithExecutor>;
    listSourceSyncTaskCandidatesByTaskIdWithExecutor: Mock<ListSourceSyncTaskCandidatesByTaskIdWithExecutor>;
  } => ({
    findLatestSourceSyncTaskBySourceIdWithExecutor: mocks.findLatestSourceSyncTaskBySourceIdWithExecutor,
    listSourceSyncTaskCandidatesByTaskIdWithExecutor: mocks.listSourceSyncTaskCandidatesByTaskIdWithExecutor,
  }),
);

vi.mock(
  '../src/services/git-source/github-app-client.adapter',
  (): {
    assertGitHubRepositoryBranchExists: Mock<AssertGitHubRepositoryBranchExists>;
    readGitHubRepositoryMetadata: Mock<ReadGitHubRepositoryMetadata>;
    resolveGitHubRepositoryInstallation: Mock<ResolveGitHubRepositoryInstallation>;
  } => ({
    assertGitHubRepositoryBranchExists: mocks.assertGitHubRepositoryBranchExists,
    readGitHubRepositoryMetadata: mocks.readGitHubRepositoryMetadata,
    resolveGitHubRepositoryInstallation: mocks.resolveGitHubRepositoryInstallation,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-connect.persistence',
  (): { persistConnectedGitSource: Mock<PersistConnectedGitSource> } => ({
    persistConnectedGitSource: mocks.persistConnectedGitSource,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-exclusion.service',
  (): { includeGitSourceDescriptorWithinTransaction: Mock<IncludeGitSourceDescriptorWithinTransaction> } => ({
    includeGitSourceDescriptorWithinTransaction: mocks.includeGitSourceDescriptorWithinTransaction,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-sync-task.service',
  (): {
    queueGitSourceSyncTaskForConnect: Mock<QueueGitSourceSyncTaskForConnect>;
    readOrCreateGitSourceSyncTaskIdForInclude: Mock<ReadOrCreateGitSourceSyncTaskIdForInclude>;
    readOrCreateGitSourceSyncTaskIdForStart: Mock<ReadOrCreateGitSourceSyncTaskIdForStart>;
  } => ({
    queueGitSourceSyncTaskForConnect: mocks.queueGitSourceSyncTaskForConnect,
    readOrCreateGitSourceSyncTaskIdForInclude: mocks.readOrCreateGitSourceSyncTaskIdForInclude,
    readOrCreateGitSourceSyncTaskIdForStart: mocks.readOrCreateGitSourceSyncTaskIdForStart,
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): {
    getApiConfig: Mock<GetApiConfig>;
    getApiDatabase: Mock<GetApiDatabase>;
  } => ({
    getApiConfig: mocks.getApiConfig,
    getApiDatabase: mocks.getApiDatabase,
  }),
);

describe('git source service', (): void => {
  beforeEach((): void => {
    mocks.requireGitProviderAccessByRegistrationId.mockResolvedValue(createProviderAccess());
    mocks.resolveGitHubRepositoryInstallation.mockResolvedValue({ installationId: 'inst_123' });
    mocks.assertGitHubRepositoryBranchExists.mockResolvedValue(undefined);
    mocks.readGitHubRepositoryMetadata.mockResolvedValue({
      defaultBranchName: 'main',
      repositoryCloneUrl: 'https://github.com/acme/mono.git',
      repositoryExternalId: 'repo_123',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
    });
    mocks.findActiveSourceByRepository.mockResolvedValue(undefined);
    mocks.findConnectedSourceById.mockResolvedValue(undefined);
    mocks.findLatestSourceSyncTaskBySourceIdWithExecutor.mockResolvedValue(undefined);
    mocks.includeGitSourceDescriptorWithinTransaction.mockResolvedValue(undefined);
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.getApiDatabase.mockReturnValue(createMockDatabase() as never);
    mocks.listActiveBindingsBySourceIds.mockResolvedValue([]);
    mocks.listBranchMappingsByBindingIds.mockResolvedValue([]);
    mocks.listSourceExcludedDescriptorsBySourceIds.mockResolvedValue([]);
    mocks.listSourceSyncTaskCandidatesByTaskIdWithExecutor.mockResolvedValue([]);
    mocks.queueGitSourceSyncTaskForConnect.mockResolvedValue('sst_connect');
    mocks.readOrCreateGitSourceSyncTaskIdForInclude.mockResolvedValue('sst_include');
    mocks.readOrCreateGitSourceSyncTaskIdForStart.mockResolvedValue('sst_sync');
    mocks.updateSourceToActive.mockImplementation(
      async (_transaction: SourceWriteExecutor, input: UpdateSourceToActiveInput): Promise<SourceRow> =>
        await Promise.resolve({
          ...createSourceRow('active', {
            defaultEnvironmentName: input.defaultEnvironmentName,
            syncBranchName: input.syncBranchName,
          }),
          defaultBranchName: input.defaultBranchName,
          providerInstallationId: input.providerInstallationId,
          providerRegistrationId: input.providerRegistrationId,
          repositoryCloneUrl: input.repositoryCloneUrl,
          repositoryName: input.repositoryName,
          repositoryOwner: input.repositoryOwner,
          updatedAt: input.updatedAt,
        }),
    );
    mocks.updateSourceProviderWebhookId.mockImplementation(
      async (_executor: SourceWriteExecutor, _sourceId: string, providerWebhookId: string | null): Promise<SourceRow> =>
        await Promise.resolve({ ...createSourceRow('active'), providerWebhookId }),
    );
  });

  it('reuses an active source matched by canonical repository id and includes the requested descriptor', async (): Promise<void> => {
    const source: SourceRow = createSourceRow('active', { syncBranchName: 'main' });
    const binding: SourceBindingRow = createSourceBindingRow({
      descriptorPath: 'apps/billing/compartment.yml',
    });
    mocks.findActiveSourceByRepository.mockResolvedValue(source);
    mocks.findConnectedSourceById.mockResolvedValue(source);
    mocks.listActiveBindingsBySourceIds.mockResolvedValue([binding]);
    mocks.listBranchMappingsByBindingIds.mockResolvedValue([createSourceBindingBranchMappingRow(binding.id)]);

    await expect(
      connectGitSource({
        ...createConnectInput(),
        request: {
          ...createConnectInput().request,
          descriptorPathToInclude: 'apps/billing/compartment.yml',
        },
      }),
    ).resolves.toMatchObject({
      sourceConnected: false,
      syncRequest: {
        descriptorPath: 'apps/billing/compartment.yml',
        requestedBranchName: 'main',
        taskId: 'sst_include',
      },
      view: {
        bindings: [
          expect.objectContaining({
            descriptorPath: 'apps/billing/compartment.yml',
          }),
        ],
        source: {
          id: 'src_123',
        },
      },
    });

    expect(mocks.findActiveSourceByRepository).toHaveBeenCalledWith('org_123', 'github.com', 'repo_123');
    expect(mocks.updateSourceToActive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerInstallationId: 'inst_123',
        providerRegistrationId: 'gpr_123',
        repositoryCloneUrl: 'https://github.com/acme/mono.git',
        sourceId: 'src_123',
      }),
    );
    expect(mocks.includeGitSourceDescriptorWithinTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'src_123',
      'apps/billing/compartment.yml',
    );
    expect(mocks.readOrCreateGitSourceSyncTaskIdForInclude).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: source.id,
        providerRegistrationId: 'gpr_123',
        syncBranchName: 'main',
      }),
      'apps/billing/compartment.yml',
      'prn_123',
    );
    expect(mocks.persistConnectedGitSource).not.toHaveBeenCalled();
  });

  it('rejects active source reuse when connect settings differ', async (): Promise<void> => {
    mocks.findActiveSourceByRepository.mockResolvedValue(createSourceRow('active', { syncBranchName: 'release' }));

    await expect(connectGitSource(createConnectInput())).rejects.toMatchObject({
      code: 'git_source_conflict',
      message:
        'This repository is already connected with different branch, environment, or automation settings. Choose the existing source settings.',
    });
    expect(mocks.readOrCreateGitSourceSyncTaskIdForInclude).not.toHaveBeenCalled();
    expect(mocks.readOrCreateGitSourceSyncTaskIdForStart).not.toHaveBeenCalled();
  });

  it('rejects active source reuse when automation settings differ', async (): Promise<void> => {
    mocks.findActiveSourceByRepository.mockResolvedValue(
      createSourceRow('active', { defaultAutoDeployEnabled: false, syncBranchName: 'main' }),
    );

    await expect(connectGitSource(createConnectInput())).rejects.toMatchObject({
      code: 'git_source_conflict',
      message:
        'This repository is already connected with different branch, environment, or automation settings. Choose the existing source settings.',
    });
    expect(mocks.readOrCreateGitSourceSyncTaskIdForInclude).not.toHaveBeenCalled();
    expect(mocks.readOrCreateGitSourceSyncTaskIdForStart).not.toHaveBeenCalled();
  });

  it('rejects connect when the selected sync branch is not accessible through the GitHub App', async (): Promise<void> => {
    mocks.assertGitHubRepositoryBranchExists.mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { status: 404 }),
    );

    await expect(
      connectGitSource({
        ...createConnectInput(),
        request: {
          ...createConnectInput().request,
          syncBranchName: 'missing-branch',
        },
      }),
    ).rejects.toMatchObject({
      code: 'git_source_repository_access_denied',
      message: 'The selected repository branch could not be read.',
    });
    expect(mocks.persistConnectedGitSource).not.toHaveBeenCalled();
  });

  it('reads disabled sources that are still connected with source defaults', async (): Promise<void> => {
    const source: SourceRow = createSourceRow('disabled');
    mocks.findConnectedSourceById.mockResolvedValue(source);

    await expect(readGitSource(createReadInput())).resolves.toEqual({
      bindings: [],
      source: {
        autoAdoptNewApps: true,
        defaultAutoDeployEnabled: true,
        defaultBranchName: 'main',
        defaultEnvironmentName: 'production',
        displayName: 'acme/mono',
        exclusions: [],
        id: 'src_123',
        latestSync: null,
        providerHost: 'github.com',
        repositoryCloneUrl: 'https://github.com/acme/mono.git',
        repositoryName: 'mono',
        repositoryOwner: 'acme',
        status: 'disabled',
      },
    });
  });
});

function createMockDatabase(): { transaction: typeof transaction } {
  return {
    transaction,
  };
}

async function transaction<TResult>(
  callback: (transaction: SourceMutationTransaction) => Promise<TResult>,
): Promise<TResult> {
  return await callback({} as SourceMutationTransaction);
}

function createConnectInput(): ConnectGitSourceInput {
  return {
    actor: {
      authSession: {
        authMethodKind: 'password' as const,
        oidcProviderId: null,
        organizationId: 'org_123',
        principalId: 'prn_123',
      },
      memberships: [
        {
          role: 'admin' as const,
          scopeId: 'org_123',
          scopeType: 'organization' as const,
        },
      ],
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      principalType: 'user' as const,
      sessionId: 'ses_123',
      tokenHash: 'hash_123',
    },
    organizationId: 'org_123',
    request: {
      autoAdoptNewApps: true,
      defaultAutoDeployEnabled: true,
      defaultEnvironmentName: 'production',
      providerHost: 'github.com',
      registrationId: 'gpr_123',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
      syncBranchName: 'main',
    },
  };
}

function createReadInput(): DisconnectGitSourceInput {
  return {
    actor: createConnectInput().actor,
    organizationId: 'org_123',
    sourceId: 'src_123',
  };
}

function createApiConfig(): ApiConfig {
  return {
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    caddyTlsMode: 'internal',
    controlPlaneHost: 'console.localhost',
    customTlsDirectory: '/tmp/compartment-tls',
    databaseUrl: 'postgres://localhost/compartment',
    edgeToken: 'edge-token',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    port: 9443,
    publicHttpPort: 9080,
    publicHttpsPort: 443,
    publicProtocol: 'http',
    auditRetentionDays: 90,
    auditRetentionCleanupBatchSize: 1000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    auditFileSink: defaultAuditFileSinkConfig,
    rollbackRetentionLimit: null,
    runtimeControlToken: 'runtime-token',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    sessionSecret: 'session-secret',
    sessionTtlMs: 604_800_000,
    sourceArchiveDirectory: '/tmp/compartment-source-archives',
    resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
    sourceArchiveMaxBytes: 104_857_600,
    throttle: defaultApiAuthThrottleConfig,
    nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
    systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
    systemToken: 'system-token',
    trustedOutboundHosts: [],
    variablesMasterKey: Buffer.alloc(32, 1),
  };
}

function createActiveRegistration(): GitProviderRegistrationRow {
  return {
    providerAccountId: null,
    providerAccountLogin: null,
    bootstrapStateId: null,
    callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    id: 'gpr_123',
    organizationId: 'org_123',
    pendingExpiresAt: null,
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    webhookSecretCiphertext: 'webhook-ciphertext',
    webhookSecretEncryptionKeyId: 'webhook-key-id',
    webhookUrl: 'https://console.example/v1/sources/git/providers/github/registrations/gpr_123/webhook',
  };
}

function createProviderAccess(): GitProviderAccess {
  return {
    credential: {
      appId: 'app_123',
      appName: 'Compartment GitHub App',
      appSlug: 'compartment',
      appUrl: 'https://github.com/apps/compartment',
      installationAccountLogin: 'acme',
      installationAccountType: 'Organization',
      installationId: 'inst_123',
      kind: 'github_app',
      privateKeyPem: 'private-key',
    },
    registration: createActiveRegistration(),
  };
}

function createSourceRow(status: TestSourceStatus, overrides: SourceRowOverrides = {}): SourceRow {
  return {
    automationPrincipalId: null,
    createdAt: new Date('2026-04-29T12:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    autoAdoptNewApps: overrides.autoAdoptNewApps ?? true,
    defaultAutoDeployEnabled: overrides.defaultAutoDeployEnabled ?? true,
    defaultBranchName: 'main',
    defaultEnvironmentName: overrides.defaultEnvironmentName ?? 'production',
    lastSyncAt: null,
    disconnectedAt: null,
    displayName: 'acme/mono',
    id: 'src_123',
    organizationId: 'org_123',
    providerHost: 'github.com',
    providerInstallationId: 'inst_123',
    providerWebhookId: null,
    providerRegistrationId: 'gpr_123',
    repositoryCloneUrl: 'https://github.com/acme/mono.git',
    repositoryExternalId: 'repo_123',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
    status,
    syncBranchName: overrides.syncBranchName ?? 'compartment/sync',
    type: 'git',
    updatedAt: new Date('2026-04-29T12:00:00.000Z'),
  };
}

function createSourceBindingRow(overrides: Partial<SourceBindingRow> = {}): SourceBindingRow {
  return {
    autoDeployEnabled: true,
    createdAt: new Date('2026-04-29T12:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    descriptorDirectory: '.',
    descriptorPath: 'compartment.yml',
    disconnectedAt: null,
    id: 'sbd_123',
    projectId: 'prj_123',
    projectName: 'mono',
    sourceId: 'src_123',
    status: 'active',
    updatedAt: new Date('2026-04-29T12:00:00.000Z'),
    watchPathsJson: '[]',
    ...overrides,
  };
}

function createSourceBindingBranchMappingRow(sourceBindingId: string): SourceBindingBranchMappingRow {
  return {
    branchName: 'main',
    createdAt: new Date('2026-04-29T12:00:00.000Z'),
    environmentName: 'production',
    id: 'sbm_123',
    sourceBindingId,
    updatedAt: new Date('2026-04-29T12:00:00.000Z'),
  };
}
