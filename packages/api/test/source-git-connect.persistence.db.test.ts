import type { Pool } from 'pg';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { describe, expect, it } from 'vitest';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  gitProviderRegistrations,
  organizations,
  principals,
  sourceBindingBranchMappings,
  sourceBindings,
  sources,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { disconnectSource, updateSourceToDisabled } from '../src/queries/source.query';
import type { SourceMutationTransaction } from '../src/queries/source.query.types';
import { persistConnectedGitSource } from '../src/services/git-source/git-source-connect.persistence';
import {
  createGitLabProviderRegistration,
  rotateGitLabProviderRegistrationToken,
} from '../src/queries/gitlab-provider-registration.query';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'git_source_connect_persistence');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'compartment.localhost',
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
type SourceRowRecord = typeof sources.$inferSelect;

describe('git source connect persistence', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await createPersistScope();
    },
  });

  it('creates a source with source-level defaults and no bindings', async (): Promise<void> => {
    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await persistConnectedGitSource(transaction, buildPersistInput('repo_1'), new Date('2026-04-28T10:00:00.000Z'));
    });

    expect(await readStoredSource()).toMatchObject({
      autoAdoptNewApps: true,
      defaultAutoDeployEnabled: true,
      defaultBranchName: 'main',
      defaultEnvironmentName: 'production',
      displayName: 'acme/mono',
      repositoryExternalId: 'repo_1',
      status: 'active',
      syncBranchName: 'main',
    });
    expect(await db.select().from(sourceBindings)).toEqual([]);
    expect(await db.select().from(sourceBindingBranchMappings)).toEqual([]);
  });

  it('persists and replaces the GitLab project hook without an installation id', async (): Promise<void> => {
    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await persistConnectedGitSource(
        transaction,
        buildPersistInput('42', {
          installationId: null,
          providerHost: 'gitlab.com',
          providerRegistrationId: 'gpr_gitlab_sources',
          providerWebhookId: 'hook_1',
        }),
        new Date('2026-04-28T10:00:00.000Z'),
      );
    });
    expect(await readStoredSource()).toMatchObject({
      providerInstallationId: null,
      providerWebhookId: 'hook_1',
    });
    const source: SourceRowRecord = requireFirst(await db.select().from(sources), 'source');
    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await disconnectSource(transaction, source.id, new Date('2026-04-28T11:00:00.000Z'));
      await persistConnectedGitSource(
        transaction,
        buildPersistInput('42', {
          installationId: null,
          providerHost: 'gitlab.com',
          providerRegistrationId: 'gpr_gitlab_sources',
          providerWebhookId: 'hook_2',
        }),
        new Date('2026-04-28T12:00:00.000Z'),
      );
    });
    expect(await readStoredSource()).toMatchObject({ providerInstallationId: null, providerWebhookId: 'hook_2' });
  });

  it('isolates GitLab registrations by organization and preserves webhook secrets on rotation', async (): Promise<void> => {
    await rotateGitLabProviderRegistrationToken(db, {
      accessTokenCiphertext: 'rotated-token',
      accessTokenEncryptionKeyId: 'rotated-key',
      organizationId: 'org_git_sources',
      registrationId: 'gpr_gitlab_sources',
      updatedAt: new Date('2026-04-28T12:00:00.000Z'),
    });
    await createGitLabProviderRegistration(db, {
      accessTokenCiphertext: 'other-token',
      accessTokenEncryptionKeyId: 'other-key',
      callbackUrl: 'https://console.example',
      createdByPrincipalId: 'prn_git_sources',
      id: 'gpr_gitlab_other_org',
      installationAccountLogin: 'alice',
      installationAccountType: 'User',
      organizationId: 'org_other',
      providerHost: 'gitlab.com',
      repositoryOwner: 'alice',
      updatedAt: new Date('2026-04-28T12:00:00.000Z'),
      webhookSecretCiphertext: 'other-secret',
      webhookSecretEncryptionKeyId: 'other-secret-key',
      webhookUrl:
        'https://console.example/v1/sources/git/providers/gitlab/organizations/org_other/registrations/gpr_gitlab_other_org/webhook',
    });
    const registrations: (typeof gitProviderRegistrations.$inferSelect)[] = await db
      .select()
      .from(gitProviderRegistrations);
    expect(registrations).toHaveLength(3);
    expect(
      registrations.find(
        (row: typeof gitProviderRegistrations.$inferSelect): boolean => row.id === 'gpr_gitlab_sources',
      ),
    ).toMatchObject({
      accessTokenCiphertext: 'rotated-token',
      webhookSecretCiphertext: 'secret',
    });
  });

  it('rejects a duplicate active GitLab registration in the same organization', async (): Promise<void> => {
    await expect(
      createGitLabProviderRegistration(db, {
        accessTokenCiphertext: 'duplicate-token',
        accessTokenEncryptionKeyId: 'duplicate-key',
        callbackUrl: 'https://console.example',
        createdByPrincipalId: 'prn_git_sources',
        id: 'gpr_gitlab_duplicate',
        installationAccountLogin: 'alice',
        installationAccountType: 'User',
        organizationId: 'org_git_sources',
        providerHost: 'gitlab.com',
        repositoryOwner: 'alice',
        updatedAt: new Date('2026-04-28T12:00:00.000Z'),
        webhookSecretCiphertext: 'duplicate-secret',
        webhookSecretEncryptionKeyId: 'duplicate-secret-key',
        webhookUrl:
          'https://console.example/v1/sources/git/providers/gitlab/organizations/org_git_sources/registrations/gpr_gitlab_duplicate/webhook',
      }),
    ).rejects.toMatchObject({
      cause: {
        code: '23505',
        constraint: 'git_provider_registrations_active_gitlab_organization_owner_uni',
      },
    });
  });

  it('reactivates a disconnected source and updates source defaults on reconnect', async (): Promise<void> => {
    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await persistConnectedGitSource(transaction, buildPersistInput('repo_1'), new Date('2026-04-28T10:00:00.000Z'));
    });
    const disconnectedSource: SourceRowRecord = requireFirst(await db.select().from(sources), 'source');

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await disconnectSource(transaction, disconnectedSource.id, new Date('2026-04-28T11:00:00.000Z'));
    });

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await persistConnectedGitSource(
        transaction,
        buildPersistInput('repo_1', {
          defaultAutoDeployEnabled: false,
          defaultEnvironmentName: 'staging',
          repositoryCloneUrl: 'https://github.com/acme/mono-renamed.git',
          syncBranchName: 'release',
        }),
        new Date('2026-04-28T12:00:00.000Z'),
      );
    });

    expect(await readStoredSource()).toMatchObject({
      autoAdoptNewApps: true,
      defaultAutoDeployEnabled: false,
      defaultEnvironmentName: 'staging',
      id: disconnectedSource.id,
      repositoryCloneUrl: 'https://github.com/acme/mono-renamed.git',
      status: 'active',
      syncBranchName: 'release',
    });
    expect(await db.select().from(sourceBindings)).toEqual([]);
  });

  it('reactivates a disabled source instead of creating a replacement row', async (): Promise<void> => {
    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await persistConnectedGitSource(transaction, buildPersistInput('repo_1'), new Date('2026-04-28T10:00:00.000Z'));
    });
    const disabledSource: SourceRowRecord = requireFirst(await db.select().from(sources), 'source');

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await updateSourceToDisabled(transaction, {
        sourceId: disabledSource.id,
        updatedAt: new Date('2026-04-28T11:00:00.000Z'),
      });
    });

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await persistConnectedGitSource(
        transaction,
        buildPersistInput('repo_1', {
          defaultAutoDeployEnabled: false,
          defaultEnvironmentName: 'staging',
          repositoryCloneUrl: 'https://github.com/acme/mono-renamed.git',
          syncBranchName: 'release',
        }),
        new Date('2026-04-28T12:00:00.000Z'),
      );
    });

    expect(await db.select().from(sources)).toHaveLength(1);
    expect(await readStoredSource()).toMatchObject({
      defaultAutoDeployEnabled: false,
      defaultEnvironmentName: 'staging',
      id: disabledSource.id,
      repositoryCloneUrl: 'https://github.com/acme/mono-renamed.git',
      status: 'active',
      syncBranchName: 'release',
    });
  });
});

async function createPersistScope(): Promise<void> {
  await db.insert(principals).values({
    email: 'git-sources@example.com',
    id: 'prn_git_sources',
    type: 'user',
  });
  await db.insert(organizations).values({
    id: 'org_git_sources',
    name: 'Git Sources Org',
    slug: 'git-sources-org',
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
    pendingExpiresAt: null,
    privateKeyPemCiphertext: null,
    privateKeyPemEncryptionKeyId: null,
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    webhookUrl:
      'https://console.example/v1/sources/git/providers/github/organizations/org_git_sources/registrations/gpr_git_sources/webhook',
  });
  await db.insert(gitProviderRegistrations).values({
    accessTokenCiphertext: 'token',
    accessTokenEncryptionKeyId: 'key',
    callbackUrl: 'https://console.example',
    createdByPrincipalId: 'prn_git_sources',
    id: 'gpr_gitlab_sources',
    providerHost: 'gitlab.com',
    providerType: 'gitlab',
    repositoryOwner: 'alice',
    status: 'active',
    webhookSecretCiphertext: 'secret',
    webhookSecretEncryptionKeyId: 'key',
    webhookUrl:
      'https://console.example/v1/sources/git/providers/gitlab/organizations/org_git_sources/registrations/gpr_gitlab_sources/webhook',
  });
}

function buildPersistInput(
  repositoryExternalId: string,
  overrides: {
    autoAdoptNewApps?: boolean | undefined;
    defaultAutoDeployEnabled?: boolean | undefined;
    defaultEnvironmentName?: string | undefined;
    repositoryCloneUrl?: string | undefined;
    installationId?: string | null | undefined;
    providerHost?: string | undefined;
    providerRegistrationId?: string | undefined;
    providerWebhookId?: string | undefined;
    syncBranchName?: string | undefined;
  } = {},
): {
  actorPrincipalId: string;
  installationId: string | null;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
  providerWebhookId?: string | undefined;
  repository: {
    defaultBranchName: string;
    repositoryCloneUrl: string;
    repositoryExternalId: string;
    repositoryName: string;
    repositoryOwner: string;
  };
  request: {
    autoAdoptNewApps: boolean;
    defaultAutoDeployEnabled: boolean;
    defaultEnvironmentName: string;
    providerHost: string;
    repositoryName: string;
    repositoryOwner: string;
    syncBranchName: string;
  };
  syncBranchName: string;
} {
  const syncBranchName: string = overrides.syncBranchName ?? 'main';

  return {
    actorPrincipalId: 'prn_git_sources',
    installationId: overrides.installationId === undefined ? 'inst_123' : overrides.installationId,
    organizationId: 'org_git_sources',
    providerHost: overrides.providerHost ?? 'github.com',
    providerRegistrationId: overrides.providerRegistrationId ?? 'gpr_git_sources',
    providerWebhookId: overrides.providerWebhookId,
    repository: {
      defaultBranchName: 'main',
      repositoryCloneUrl: overrides.repositoryCloneUrl ?? 'https://github.com/acme/mono.git',
      repositoryExternalId,
      repositoryName: 'mono',
      repositoryOwner: 'acme',
    },
    request: {
      autoAdoptNewApps: overrides.autoAdoptNewApps ?? true,
      defaultAutoDeployEnabled: overrides.defaultAutoDeployEnabled ?? true,
      defaultEnvironmentName: overrides.defaultEnvironmentName ?? 'production',
      providerHost: overrides.providerHost ?? 'github.com',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
      syncBranchName,
    },
    syncBranchName,
  };
}

async function readStoredSource(): Promise<typeof sources.$inferSelect | undefined> {
  const rows: SourceRowRecord[] = await db.select().from(sources);
  return rows[0];
}

function requireFirst<T>(values: readonly T[], label: string): T {
  const value: T | undefined = values[0];
  if (value === undefined) {
    throw new Error(`Expected ${label} to exist.`);
  }

  return value;
}
