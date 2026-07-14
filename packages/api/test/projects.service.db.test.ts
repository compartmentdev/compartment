import type { ExistingProjectRemoteState } from '@compartment/contracts';
import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  gitProviderRegistrations,
  organizationMemberships,
  organizations,
  principals,
  projects,
  sourceBindings,
  sourceExcludedDescriptors,
  sourceEvents,
  sourceResolutionTasks,
  sources,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import type { RbacTransaction } from '../src/queries/rbac.query.types';
import type { resolveActiveProjectScope, resolveRequiredProjectScope } from '../src/services/project-scope.service';
import {
  archiveProjectForPrincipal,
  deleteProjectForPrincipal,
  getActiveProjectForPrincipal,
  renameProjectForPrincipal,
} from '../src/services/projects.service';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from '../src/services/rbac-seed.service';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

type ResolveActiveProjectScope = typeof resolveActiveProjectScope;
type ResolveRequiredProjectScope = typeof resolveRequiredProjectScope;

interface ProjectScopeServiceModule {
  resolveActiveProjectScope: Mock<ResolveActiveProjectScope>;
  resolveRequiredProjectScope: Mock<ResolveRequiredProjectScope>;
}

interface ProjectScopeMocks {
  resolveActiveProjectScope: Mock<ResolveActiveProjectScope>;
  resolveRequiredProjectScope: Mock<ResolveRequiredProjectScope>;
}

const mocks: ProjectScopeMocks = vi.hoisted(
  (): ProjectScopeMocks => ({
    resolveActiveProjectScope: vi.fn<ResolveActiveProjectScope>(),
    resolveRequiredProjectScope: vi.fn<ResolveRequiredProjectScope>(),
  }),
);

vi.mock(
  '../src/services/project-scope.service',
  (): ProjectScopeServiceModule => ({
    resolveActiveProjectScope: mocks.resolveActiveProjectScope,
    resolveRequiredProjectScope: mocks.resolveRequiredProjectScope,
  }),
);

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'projects_service_db');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  customTlsDirectory: '/etc/compartment/tls',
  databaseUrl,
  edgeToken: 'test-edge-token',
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
  runtimeControlToken: 'test-runtime-control-token',
  runtimeDefaultUpstreamHost: '127.0.0.1',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('projects service', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await seedDeleteScope();
      mocks.resolveActiveProjectScope.mockReset();
      mocks.resolveRequiredProjectScope.mockResolvedValue(createResolvedProjectScope());
    },
  });

  it('blocks renaming projects while an active git binding exists', async (): Promise<void> => {
    mocks.resolveActiveProjectScope.mockResolvedValue(
      createResolvedProjectScope({
        archivedAt: null,
        projectId: 'prj_ops',
        projectName: 'ops',
      }),
    );

    await expect(
      renameProjectForPrincipal({
        nextProjectName: 'ops-renamed',
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'ops',
      }),
    ).rejects.toMatchObject({ code: 'project_git_source_bound' });

    expect(await db.select().from(projects).where(eq(projects.id, 'prj_ops'))).toMatchObject([
      {
        name: 'ops',
      },
    ]);
    expect(await db.select().from(sourceBindings).where(eq(sourceBindings.id, 'sbd_ops_active'))).toMatchObject([
      {
        descriptorDirectory: 'apps/ops',
        descriptorPath: 'apps/ops/compartment.yml',
        projectId: 'prj_ops',
        projectName: 'ops',
        status: 'active',
      },
    ]);
  });

  it('deletes archived projects after disconnecting their git source', async (): Promise<void> => {
    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).resolves.toBe('billing');

    expect(await db.select().from(projects).where(eq(projects.id, 'prj_billing'))).toHaveLength(0);
    expect(
      await db.select().from(sourceBindings).where(eq(sourceBindings.id, 'sbd_billing_disconnected')),
    ).toMatchObject([
      {
        projectId: null,
        status: 'disconnected',
      },
    ]);
  });

  it('blocks deleting archived projects while an active git binding exists', async (): Promise<void> => {
    await db
      .update(projects)
      .set({
        archivedAt: new Date('2026-04-28T12:10:00.000Z'),
        updatedAt: new Date('2026-04-28T12:10:00.000Z'),
      })
      .where(eq(projects.id, 'prj_ops'));
    mocks.resolveRequiredProjectScope.mockResolvedValue(
      createResolvedProjectScope({
        archivedAt: new Date('2026-04-28T12:10:00.000Z'),
        projectId: 'prj_ops',
        projectName: 'ops',
      }),
    );

    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'ops',
      }),
    ).rejects.toMatchObject({ code: 'project_git_source_bound' });

    expect(await db.select().from(projects).where(eq(projects.id, 'prj_ops'))).toMatchObject([
      {
        archivedAt: new Date('2026-04-28T12:10:00.000Z'),
        name: 'ops',
      },
    ]);
    expect(await db.select().from(sourceBindings).where(eq(sourceBindings.id, 'sbd_ops_active'))).toMatchObject([
      {
        descriptorDirectory: 'apps/ops',
        descriptorPath: 'apps/ops/compartment.yml',
        projectId: 'prj_ops',
        projectName: 'ops',
        status: 'active',
      },
    ]);
  });

  it('archives git-bound projects by disconnecting the binding and creating an exclusion', async (): Promise<void> => {
    mocks.resolveRequiredProjectScope.mockResolvedValue(
      createResolvedProjectScope({
        archivedAt: null,
        projectId: 'prj_ops',
        projectName: 'ops',
      }),
    );

    const archivedProject: {
      archivedAt: Date | null;
      createdAt: Date;
      id: string;
      name: string;
      organizationId: string;
      updatedAt: Date;
    } = await archiveProjectForPrincipal({
      organizationSlug: 'acme-dev',
      principalId: 'prn_git_sources',
      projectName: 'ops',
    });

    expect(archivedProject.id).toBe('prj_ops');
    expect(archivedProject.archivedAt).toBeInstanceOf(Date);
    const storedProject: (typeof projects.$inferSelect)[] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, 'prj_ops'));
    expect(storedProject[0]?.archivedAt).toBeInstanceOf(Date);
    expect(await db.select().from(sourceBindings).where(eq(sourceBindings.id, 'sbd_ops_active'))).toMatchObject([
      {
        status: 'disconnected',
      },
    ]);
    expect(
      await db.select().from(sourceExcludedDescriptors).where(eq(sourceExcludedDescriptors.sourceId, 'src_ops_active')),
    ).toMatchObject([
      {
        descriptorPath: 'apps/ops/compartment.yml',
      },
    ]);
    expect(
      await db.select().from(sourceResolutionTasks).where(eq(sourceResolutionTasks.sourceBindingId, 'sbd_ops_active')),
    ).toMatchObject([
      {
        failureReason: 'Git source binding was excluded from source sync.',
        status: 'canceled',
      },
    ]);
  });

  it.each([
    ['active', 'prj_ops', 'ops'],
    ['disconnected', 'prj_billing', 'billing'],
    ['active', 'prj_plain', 'plain'],
  ] satisfies [ExistingProjectRemoteState, string, string][])(
    'reads %s remote state for project show',
    async (expectedRemoteState: ExistingProjectRemoteState, projectId: string, projectName: string): Promise<void> => {
      mocks.resolveActiveProjectScope.mockResolvedValue(
        createResolvedProjectScope({
          archivedAt: null,
          projectId,
          projectName,
        }),
      );

      await expect(
        getActiveProjectForPrincipal({
          organizationSlug: 'acme-dev',
          principalId: 'prn_git_sources',
          projectName,
        }),
      ).resolves.toMatchObject({
        project: {
          id: projectId,
          name: projectName,
        },
        remoteState: expectedRemoteState,
      });
    },
  );
});

async function seedDeleteScope(): Promise<void> {
  await db.insert(principals).values({
    email: 'git-sources@example.com',
    id: 'prn_git_sources',
    type: 'user',
  });
  await db.insert(organizations).values({
    id: 'org_git_sources',
    name: 'Git Sources Org',
    slug: 'acme-dev',
  });
  await db.insert(organizationMemberships).values({
    id: 'mem_git_sources',
    organizationId: 'org_git_sources',
    principalId: 'prn_git_sources',
  });
  await db.transaction(async (transaction: RbacTransaction): Promise<void> => {
    await assignOrganizationSystemRoleToPrincipalWithExecutor(
      transaction,
      'org_git_sources',
      'prn_git_sources',
      'admin',
    );
  });
  await db.insert(projects).values({
    archivedAt: new Date('2026-04-28T12:00:00.000Z'),
    id: 'prj_billing',
    name: 'billing',
    organizationId: 'org_git_sources',
    updatedAt: new Date('2026-04-28T12:00:00.000Z'),
  });
  await db.insert(projects).values({
    archivedAt: null,
    id: 'prj_ops',
    name: 'ops',
    organizationId: 'org_git_sources',
    updatedAt: new Date('2026-04-28T12:00:00.000Z'),
  });
  await db.insert(projects).values({
    archivedAt: null,
    id: 'prj_plain',
    name: 'plain',
    organizationId: 'org_git_sources',
    updatedAt: new Date('2026-04-28T12:00:00.000Z'),
  });
  await db.insert(gitProviderRegistrations).values({
    appId: 'app_123',
    appName: 'Compartment GitHub App',
    appSlug: 'compartment-github-app',
    appUrl: 'https://github.com/apps/compartment-github-app',
    bootstrapStateId: null,
    callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
    createdByPrincipalId: 'prn_git_sources',
    id: 'gpr_git_sources',
    installationId: 'inst_123',
    organizationId: 'org_git_sources',
    pendingExpiresAt: null,
    privateKeyPemCiphertext: 'private-key-ciphertext',
    privateKeyPemEncryptionKeyId: 'private-key-id',
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    webhookSecretCiphertext: 'webhook-secret-ciphertext',
    webhookSecretEncryptionKeyId: 'webhook-secret-key-id',
    webhookUrl:
      'https://console.example/v1/sources/git/providers/github/organizations/org_git_sources/registrations/gpr_git_sources/webhook',
  });
  await db.insert(sources).values({
    autoAdoptNewApps: true,
    createdByPrincipalId: 'prn_git_sources',
    defaultAutoDeployEnabled: false,
    defaultBranchName: 'main',
    defaultEnvironmentName: 'production',
    disconnectedAt: new Date('2026-04-28T12:05:00.000Z'),
    displayName: 'acme/mono',
    id: 'src_billing_disconnected',
    organizationId: 'org_git_sources',
    providerHost: 'github.com',
    providerInstallationId: 'inst_123',
    providerRegistrationId: 'gpr_git_sources',
    repositoryCloneUrl: 'https://github.com/acme/mono.git',
    repositoryExternalId: 'repo_123',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
    status: 'disconnected',
    syncBranchName: 'main',
    type: 'git',
    updatedAt: new Date('2026-04-28T12:05:00.000Z'),
  });
  await db.insert(sourceBindings).values({
    autoDeployEnabled: false,
    createdByPrincipalId: 'prn_git_sources',
    descriptorDirectory: '.',
    descriptorPath: 'compartment.yml',
    disconnectedAt: new Date('2026-04-28T12:05:00.000Z'),
    id: 'sbd_billing_disconnected',
    projectId: 'prj_billing',
    projectName: 'billing',
    sourceId: 'src_billing_disconnected',
    status: 'disconnected',
    updatedAt: new Date('2026-04-28T12:05:00.000Z'),
  });
  await db.insert(sources).values({
    autoAdoptNewApps: true,
    createdByPrincipalId: 'prn_git_sources',
    defaultAutoDeployEnabled: true,
    defaultBranchName: 'main',
    defaultEnvironmentName: 'production',
    disconnectedAt: null,
    displayName: 'acme/ops',
    id: 'src_ops_active',
    organizationId: 'org_git_sources',
    providerHost: 'github.com',
    providerInstallationId: 'inst_456',
    providerRegistrationId: 'gpr_git_sources',
    repositoryCloneUrl: 'https://github.com/acme/ops.git',
    repositoryExternalId: 'repo_456',
    repositoryName: 'ops',
    repositoryOwner: 'acme',
    status: 'active',
    syncBranchName: 'main',
    type: 'git',
    updatedAt: new Date('2026-04-28T12:05:00.000Z'),
  });
  await db.insert(sourceBindings).values({
    autoDeployEnabled: true,
    createdByPrincipalId: 'prn_git_sources',
    descriptorDirectory: 'apps/ops',
    descriptorPath: 'apps/ops/compartment.yml',
    disconnectedAt: null,
    id: 'sbd_ops_active',
    projectId: 'prj_ops',
    projectName: 'ops',
    sourceId: 'src_ops_active',
    status: 'active',
    updatedAt: new Date('2026-04-28T12:05:00.000Z'),
  });
  await db.insert(sourceEvents).values({
    branchName: 'main',
    changedFilesComplete: true,
    changedFilesJson: '[]',
    commitSha: 'sha_ops_pending',
    eventType: 'push',
    id: 'sev_ops_pending',
    payloadJson: '{}',
    providerDeliveryId: 'delivery_ops_pending',
    sourceId: 'src_ops_active',
    status: 'tasks_created',
    updatedAt: new Date('2026-04-28T12:06:00.000Z'),
  });
  await db.insert(sourceResolutionTasks).values({
    branchName: 'main',
    commitSha: 'sha_ops_pending',
    id: 'srt_ops_pending',
    maxAttempts: 5,
    sourceBindingId: 'sbd_ops_active',
    sourceEventId: 'sev_ops_pending',
    sourceId: 'src_ops_active',
    status: 'pending',
    targetEnvironmentName: 'production',
    updatedAt: new Date('2026-04-28T12:06:00.000Z'),
  });
}

function createResolvedProjectScope(
  options: {
    archivedAt?: Date | null;
    projectId?: string;
    projectName?: string;
  } = {},
): {
  access: { role: 'admin'; scopeId: string; scopeType: 'organization' };
  organization: { id: string; name: string; slug: string };
  project: {
    archivedAt: Date | null;
    createdAt: Date;
    id: string;
    name: string;
    organizationId: string;
    updatedAt: Date;
  };
} {
  return {
    access: {
      role: 'admin' as const,
      scopeId: 'org_git_sources',
      scopeType: 'organization' as const,
    },
    organization: {
      id: 'org_git_sources',
      name: 'Git Sources Org',
      slug: 'acme-dev',
    },
    project: {
      archivedAt: options.archivedAt ?? new Date('2026-04-28T12:00:00.000Z'),
      createdAt: new Date('2026-04-28T11:00:00.000Z'),
      id: options.projectId ?? 'prj_billing',
      name: options.projectName ?? 'billing',
      organizationId: 'org_git_sources',
      updatedAt: new Date('2026-04-28T12:00:00.000Z'),
    },
  };
}
