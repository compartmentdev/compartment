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
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'git_source_connect_persistence');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
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
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
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
}

function buildPersistInput(
  repositoryExternalId: string,
  overrides: {
    autoAdoptNewApps?: boolean | undefined;
    defaultAutoDeployEnabled?: boolean | undefined;
    defaultEnvironmentName?: string | undefined;
    repositoryCloneUrl?: string | undefined;
    syncBranchName?: string | undefined;
  } = {},
): {
  actorPrincipalId: string;
  installationId: string;
  organizationId: string;
  providerHost: string;
  providerRegistrationId: string;
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
    installationId: 'inst_123',
    organizationId: 'org_git_sources',
    providerHost: 'github.com',
    providerRegistrationId: 'gpr_git_sources',
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
      providerHost: 'github.com',
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
