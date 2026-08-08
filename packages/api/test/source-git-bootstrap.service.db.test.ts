import type { Pool, PoolClient } from 'pg';
import { eq } from 'drizzle-orm';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  gitProviderBootstrapStates,
  gitProviderRegistrations,
  organizationMemberships,
  organizations,
  principals,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  activateGitProviderRegistration,
  failGitProviderRegistration,
} from '../src/queries/git-provider-registration.query';
import type {
  GitProviderRegistrationRow,
  GitProviderWriteExecutor,
} from '../src/queries/git-provider-registration.query.types';
import type { Actor } from '../src/services/auth-actor.types';
import type * as GitHubAppClientAdapter from '../src/services/git-source/github-app-client.adapter';
import type { GitHubAppInstallation } from '../src/services/git-source/github-app-client.adapter.types';
import type * as GitHubAppBootstrapAdapter from '../src/services/git-source/github-app-bootstrap.adapter';
import type * as GitSourceBootstrapPersistence from '../src/services/git-source/git-source-bootstrap.persistence';
import {
  readGitHubProviderBootstrapPage,
  readGitHubProviderBootstrapStatus,
  startGitHubProviderBootstrap,
} from '../src/services/git-source/git-source-bootstrap.service';
import {
  completeGitHubProviderBootstrapCallback,
  completeGitHubProviderBootstrapSetup,
} from '../src/services/git-source/git-source-bootstrap-completion.service';
import type {
  GitHubProviderBootstrapPage,
  GitHubProviderBootstrapManifestPage,
  GitHubProviderBootstrapView,
} from '../src/services/git-source/git-source.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { waitForConcurrentDatabaseWork } from './api-integration.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

interface ParsedManifestPayload {
  default_events?: string[];
  default_permissions?: Record<string, string>;
  hook_attributes?: {
    active: boolean;
    url: string;
  };
  redirect_url?: string;
  setup_url?: string;
}

type GitProviderRegistrationRowRecord = typeof gitProviderRegistrations.$inferSelect;

type ReadGitHubAppManifestPlan = typeof GitHubAppBootstrapAdapter.readGitHubAppManifestPlan;
type ExchangeGitHubAppManifestCode = typeof GitHubAppClientAdapter.exchangeGitHubAppManifestCode;
type ReadGitHubAppInstallation = typeof GitHubAppClientAdapter.readGitHubAppInstallation;
type AssertGitHubAppStillExists = typeof GitHubAppClientAdapter.assertGitHubAppStillExists;
type ActivatePersistedGitHubProviderRegistration =
  typeof GitSourceBootstrapPersistence.activatePersistedGitHubProviderRegistration;
type PersistPendingGitHubProviderManifestExchange =
  typeof GitSourceBootstrapPersistence.persistPendingGitHubProviderManifestExchange;

interface GitHubAppBootstrapAdapterModule {
  readGitHubAppManifestPlan: Mock<ReadGitHubAppManifestPlan>;
}

interface GitHubAppClientAdapterModule {
  assertGitHubAppStillExists: Mock<AssertGitHubAppStillExists>;
  exchangeGitHubAppManifestCode: Mock<ExchangeGitHubAppManifestCode>;
  readGitHubAppInstallation: Mock<ReadGitHubAppInstallation>;
}

interface GitSourceBootstrapPersistenceModule {
  activatePersistedGitHubProviderRegistration: Mock<ActivatePersistedGitHubProviderRegistration>;
  persistPendingGitHubProviderManifestExchange: Mock<PersistPendingGitHubProviderManifestExchange>;
}

const bootstrapAdapterMocks: GitHubAppBootstrapAdapterModule = vi.hoisted(
  (): GitHubAppBootstrapAdapterModule => ({
    readGitHubAppManifestPlan: vi.fn<ReadGitHubAppManifestPlan>(),
  }),
);

const mocks: GitHubAppClientAdapterModule = vi.hoisted(
  (): GitHubAppClientAdapterModule => ({
    assertGitHubAppStillExists: vi.fn<AssertGitHubAppStillExists>(),
    exchangeGitHubAppManifestCode: vi.fn<ExchangeGitHubAppManifestCode>(),
    readGitHubAppInstallation: vi.fn<ReadGitHubAppInstallation>(),
  }),
);

const persistenceMocks: GitSourceBootstrapPersistenceModule = vi.hoisted(
  (): GitSourceBootstrapPersistenceModule => ({
    activatePersistedGitHubProviderRegistration: vi.fn<ActivatePersistedGitHubProviderRegistration>(),
    persistPendingGitHubProviderManifestExchange: vi.fn<PersistPendingGitHubProviderManifestExchange>(),
  }),
);

vi.mock(
  '../src/services/git-source/github-app-bootstrap.adapter',
  async (): Promise<typeof GitHubAppBootstrapAdapter> => {
    const actual: typeof GitHubAppBootstrapAdapter = await vi.importActual<typeof GitHubAppBootstrapAdapter>(
      '../src/services/git-source/github-app-bootstrap.adapter',
    );
    return {
      ...actual,
      readGitHubAppManifestPlan: bootstrapAdapterMocks.readGitHubAppManifestPlan,
    };
  },
);

vi.mock('../src/services/git-source/github-app-client.adapter', async (): Promise<typeof GitHubAppClientAdapter> => {
  const actual: typeof GitHubAppClientAdapter = await vi.importActual<typeof GitHubAppClientAdapter>(
    '../src/services/git-source/github-app-client.adapter',
  );
  return {
    ...actual,
    assertGitHubAppStillExists: mocks.assertGitHubAppStillExists,
    exchangeGitHubAppManifestCode: mocks.exchangeGitHubAppManifestCode,
    readGitHubAppInstallation: mocks.readGitHubAppInstallation,
  };
});

vi.mock(
  '../src/services/git-source/git-source-bootstrap.persistence',
  async (): Promise<typeof GitSourceBootstrapPersistence> => {
    const actual: typeof GitSourceBootstrapPersistence = await vi.importActual<typeof GitSourceBootstrapPersistence>(
      '../src/services/git-source/git-source-bootstrap.persistence',
    );
    return {
      ...actual,
      activatePersistedGitHubProviderRegistration: persistenceMocks.activatePersistedGitHubProviderRegistration,
      persistPendingGitHubProviderManifestExchange: persistenceMocks.persistPendingGitHubProviderManifestExchange,
    };
  },
);

const pendingBootstrapInsertLockNamespace: number = 184;
const pendingBootstrapInsertLockKey: number = 332;
const blockPendingBootstrapInsertFunctionName: string = 'block_github_pending_bootstrap_insert_test_fn';
const blockPendingBootstrapInsertTriggerName: string = 'block_github_pending_bootstrap_insert_test';
const concurrentInsertWaitTimeoutMs: number = 5_000;
const gitSourceOrganizationId: string = 'org_git_sources';
const otherGitSourceOrganizationId: string = 'org_other_git_sources';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'git_source_bootstrap_service');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
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
  trustedOutboundHosts: [],
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};

const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('git source bootstrap service', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await db.insert(principals).values([
        {
          email: 'git-admin@example.com',
          id: 'prn_git_admin',
          type: 'user',
        },
        {
          email: 'git-reviewer@example.com',
          id: 'prn_git_reviewer',
          type: 'user',
        },
      ]);
      await db.insert(organizations).values([
        {
          id: gitSourceOrganizationId,
          name: 'Git Sources',
          slug: 'git-sources',
        },
        {
          id: otherGitSourceOrganizationId,
          name: 'Other Git Sources',
          slug: 'other-git-sources',
        },
      ]);
      await db.insert(organizationMemberships).values([
        {
          id: 'mem_git_admin',
          organizationId: gitSourceOrganizationId,
          principalId: 'prn_git_admin',
        },
        {
          id: 'mem_git_admin_other',
          organizationId: otherGitSourceOrganizationId,
          principalId: 'prn_git_admin',
        },
        {
          id: 'mem_git_reviewer',
          organizationId: gitSourceOrganizationId,
          principalId: 'prn_git_reviewer',
        },
      ]);
      bootstrapAdapterMocks.readGitHubAppManifestPlan.mockResolvedValue({
        formActionUrl: 'https://github.com/organizations/acme/settings/apps/new',
        manifestJson:
          '{"name":"Compartment","redirect_url":"https://console.example/v1/sources/git/providers/github/callback","setup_url":"https://console.example/v1/sources/git/providers/github/setup","default_events":["push"],"hook_attributes":{"active":true,"url":"https://console.example/v1/sources/git/providers/github/organizations/org_git_sources/registrations/gpr_mock/webhook"}}',
      });
      mocks.exchangeGitHubAppManifestCode.mockResolvedValue({
        appId: '12345',
        appName: 'Compartment',
        appSlug: 'compartment',
        appUrl: 'https://github.com/apps/compartment',
        privateKeyPem: '---PRIVATE KEY---',
        webhookSecret: 'webhook-secret',
      });
      mocks.assertGitHubAppStillExists.mockResolvedValue(undefined);
      mocks.readGitHubAppInstallation.mockResolvedValue({
        accountLogin: 'acme',
        accountType: 'Organization',
        installationId: '98765',
      });
      const actualBootstrapPersistence: typeof GitSourceBootstrapPersistence = await vi.importActual<
        typeof GitSourceBootstrapPersistence
      >('../src/services/git-source/git-source-bootstrap.persistence');
      persistenceMocks.persistPendingGitHubProviderManifestExchange.mockImplementation(
        actualBootstrapPersistence.persistPendingGitHubProviderManifestExchange,
      );
      persistenceMocks.activatePersistedGitHubProviderRegistration.mockImplementation(
        actualBootstrapPersistence.activatePersistedGitHubProviderRegistration,
      );
    },
  });

  afterEach((): void => {
    mocks.assertGitHubAppStillExists.mockReset();
    bootstrapAdapterMocks.readGitHubAppManifestPlan.mockReset();
    mocks.readGitHubAppInstallation.mockReset();
    persistenceMocks.persistPendingGitHubProviderManifestExchange.mockReset();
    persistenceMocks.activatePersistedGitHubProviderRegistration.mockReset();
  });

  it('requires GitHub Enterprise provider hosts to be trusted by the install', async (): Promise<void> => {
    await expect(
      startGitHubProviderBootstrap({
        actor: createGitSourceActor(),
        organizationId: gitSourceOrganizationId,
        compartmentUrl: 'https://console.example',
        providerHost: 'github.enterprise.example',
        repositoryOwner: 'acme',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_registration_failed',
      message:
        'GitHub Enterprise provider host github.enterprise.example must be listed in COMPARTMENT_TRUSTED_OUTBOUND_HOSTS.',
    });
    expect(bootstrapAdapterMocks.readGitHubAppManifestPlan).not.toHaveBeenCalled();
  });

  it('persists a manifest exchange and activates the bootstrap after repo installation', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    expect(bootstrap.status).toBe('pending');
    expect(bootstrap.bootstrapStateId).toMatch(/^gps_/);
    expect(bootstrap.browserUrl).toContain('/v1/sources/git/providers/github/bootstrap/');

    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);
    const manifest: ParsedManifestPayload = JSON.parse(page.manifestJson) as ParsedManifestPayload;

    expect(page.stateNonce).toMatch(/^gst_/);
    expect(page.formActionUrl).toBe('https://github.com/organizations/acme/settings/apps/new');
    expect(manifest.redirect_url).toBe('https://console.example/v1/sources/git/providers/github/callback');
    expect(manifest.setup_url).toBe('https://console.example/v1/sources/git/providers/github/setup');
    expect(manifest.default_events).toEqual(['push']);
    expect(manifest.hook_attributes).toEqual({
      active: true,
      url: 'https://console.example/v1/sources/git/providers/github/organizations/org_git_sources/registrations/gpr_mock/webhook',
    });

    const installUrl: string = await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    const pendingStatus: GitHubProviderBootstrapView = await readGitHubProviderBootstrapStatus({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      bootstrapStateId: bootstrap.bootstrapStateId!,
    });
    const installPage: GitHubProviderBootstrapPage = await readGitHubProviderBootstrapPage({
      actorPrincipalId: 'prn_git_admin',
      bootstrapStateId: bootstrap.bootstrapStateId!,
    });
    const [registration] = await db.select().from(gitProviderRegistrations);

    expect(installUrl).toBe(
      `https://github.com/apps/compartment/installations/new?state=${bootstrap.bootstrapStateId}`,
    );
    expect(pendingStatus).toMatchObject({
      bootstrapStateId: bootstrap.bootstrapStateId,
      browserUrl: `http://console.localhost:9080/v1/sources/git/providers/github/bootstrap/${bootstrap.bootstrapStateId}/start`,
      providerHost: 'github.com',
      registrationId: registration?.id,
      repositoryOwner: 'acme',
      status: 'pending',
    });
    expect(installPage).toEqual({
      installUrl,
      kind: 'install',
    });
    expect(registration).toMatchObject({
      appId: '12345',
      appSlug: 'compartment',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
      status: 'pending',
    });
    expect(registration?.privateKeyPemCiphertext).toBeTruthy();
    expect(registration?.webhookUrl).toBe(
      `https://console.example/v1/sources/git/providers/github/organizations/${gitSourceOrganizationId}/registrations/${registration?.id}/webhook`,
    );
    expect(registration?.webhookSecretCiphertext).toBeTruthy();
    expect(registration?.webhookSecretEncryptionKeyId).toBeTruthy();

    await completeGitHubProviderBootstrapSetup(bootstrap.bootstrapStateId!, '98765');

    const activeStatus: GitHubProviderBootstrapView = await readGitHubProviderBootstrapStatus({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      bootstrapStateId: bootstrap.bootstrapStateId!,
    });
    const [activeRegistration] = await db.select().from(gitProviderRegistrations);
    const [state] = await db.select().from(gitProviderBootstrapStates);

    expect(activeStatus).toMatchObject({
      bootstrapStateId: bootstrap.bootstrapStateId,
      browserUrl: null,
      providerHost: 'github.com',
      registrationId: activeRegistration?.id,
      repositoryOwner: 'acme',
      status: 'active',
    });
    expect(activeRegistration).toMatchObject({
      appId: '12345',
      appSlug: 'compartment',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
      status: 'active',
    });
    expect(state?.completedAt).not.toBeNull();
  });

  it('reuses the same pending bootstrap until callback completion', async (): Promise<void> => {
    const firstBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    const secondBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    expect(secondBootstrap).toEqual(firstBootstrap);
    expect(await db.select().from(gitProviderRegistrations)).toHaveLength(1);
    expect(await db.select().from(gitProviderBootstrapStates)).toHaveLength(1);
  });

  it('registers the same repository owner separately per organization', async (): Promise<void> => {
    const firstBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    const otherBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: otherGitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    expect(otherBootstrap.registrationId).not.toBe(firstBootstrap.registrationId);

    const registrations: GitProviderRegistrationRowRecord[] = await db.select().from(gitProviderRegistrations);
    expect(
      registrations.map((registration: GitProviderRegistrationRowRecord): [string, string] => [
        registration.id,
        registration.organizationId,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [firstBootstrap.registrationId, gitSourceOrganizationId],
        [otherBootstrap.registrationId, otherGitSourceOrganizationId],
      ]),
    );
    expect(registrations).toHaveLength(2);
  });

  it('does not expose another organization pending GitHub provider registration', async (): Promise<void> => {
    const firstBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    await expect(
      readGitHubProviderBootstrapStatus({
        actor: createGitSourceActor(),
        organizationId: otherGitSourceOrganizationId,
        bootstrapStateId: firstBootstrap.bootstrapStateId!,
      }),
    ).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
    await expect(
      readGitHubProviderBootstrapStatus({
        actor: createGitSourceActor(),
        organizationId: gitSourceOrganizationId,
        bootstrapStateId: firstBootstrap.bootstrapStateId!,
      }),
    ).resolves.toMatchObject({
      registrationId: firstBootstrap.registrationId,
      status: 'pending',
    });

    const registrations: GitProviderRegistrationRowRecord[] = await db.select().from(gitProviderRegistrations);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.organizationId).toBe(gitSourceOrganizationId);
  });

  it('refuses to activate another organization pending registration', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    await expect(
      activateGitProviderRegistration(db, {
        id: bootstrap.registrationId,
        installationAccountLogin: 'acme',
        installationAccountType: 'Organization',
        installationId: '98765',
        organizationId: otherGitSourceOrganizationId,
        status: 'active',
        updatedAt: new Date(),
      }),
    ).resolves.toBeUndefined();

    const [registration] = await db.select().from(gitProviderRegistrations);
    expect(registration).toMatchObject({
      installationId: null,
      organizationId: gitSourceOrganizationId,
      status: 'pending',
    });
  });

  it('reuses a pending install bootstrap when the GitHub app still authenticates', async (): Promise<void> => {
    const firstBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(firstBootstrap.bootstrapStateId!);

    await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    mocks.assertGitHubAppStillExists.mockResolvedValueOnce(undefined);

    const secondBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    expect(secondBootstrap).toEqual(firstBootstrap);
    expect(mocks.assertGitHubAppStillExists).toHaveBeenCalledTimes(1);
    expect(await db.select().from(gitProviderRegistrations)).toHaveLength(1);
    expect(await db.select().from(gitProviderBootstrapStates)).toHaveLength(1);
  });

  it('recovers from a concurrent start uniqueness race by re-reading the pending bootstrap', async (): Promise<void> => {
    const bootstrapInsertLockClient: PoolClient = await pool.connect();

    try {
      await installPendingBootstrapInsertBlocker();
      await bootstrapInsertLockClient.query('select pg_advisory_lock($1, $2)', [
        pendingBootstrapInsertLockNamespace,
        pendingBootstrapInsertLockKey,
      ]);

      const firstBootstrapPromise: Promise<GitHubProviderBootstrapView> = startGitHubProviderBootstrap({
        actor: createGitSourceActor(),
        organizationId: gitSourceOrganizationId,
        compartmentUrl: 'https://console.example',
        providerHost: 'github.com',
        repositoryOwner: 'acme',
      });
      await waitForPendingBootstrapInsertWaiters(1);

      const secondBootstrapPromise: Promise<GitHubProviderBootstrapView> = startGitHubProviderBootstrap({
        actor: createGitSourceActor(),
        organizationId: gitSourceOrganizationId,
        compartmentUrl: 'https://console.example',
        providerHost: 'github.com',
        repositoryOwner: 'acme',
      });
      await waitForPendingBootstrapInsertWaiters(2);

      await bootstrapInsertLockClient.query('select pg_advisory_unlock($1, $2)', [
        pendingBootstrapInsertLockNamespace,
        pendingBootstrapInsertLockKey,
      ]);

      const [firstBootstrapResult, secondBootstrapResult]: [GitHubProviderBootstrapView, GitHubProviderBootstrapView] =
        await Promise.all([firstBootstrapPromise, secondBootstrapPromise]);
      const registrations: GitProviderRegistrationRowRecord[] = await db.select().from(gitProviderRegistrations);
      const states: (typeof gitProviderBootstrapStates.$inferSelect)[] = await db
        .select()
        .from(gitProviderBootstrapStates);

      expect(firstBootstrapResult).toEqual(secondBootstrapResult);
      expect(firstBootstrapResult).toMatchObject({
        browserUrl: `https://console.example/v1/sources/git/providers/github/bootstrap/${firstBootstrapResult.bootstrapStateId}/start`,
        providerHost: 'github.com',
        repositoryOwner: 'acme',
        status: 'pending',
      });
      expect(registrations).toHaveLength(1);
      expect(registrations[0]).toMatchObject({
        id: firstBootstrapResult.registrationId,
        providerHost: 'github.com',
        repositoryOwner: 'acme',
        status: 'pending',
      });
      expect(states).toHaveLength(1);
      expect(states[0]).toMatchObject({
        id: firstBootstrapResult.bootstrapStateId,
        providerHost: 'github.com',
        providerRegistrationId: firstBootstrapResult.registrationId,
        repositoryOwner: 'acme',
      });
    } finally {
      await bootstrapInsertLockClient.query('select pg_advisory_unlock($1, $2)', [
        pendingBootstrapInsertLockNamespace,
        pendingBootstrapInsertLockKey,
      ]);
      bootstrapInsertLockClient.release();
      await removePendingBootstrapInsertBlocker();
    }
  });

  it('fails an expired pending registration before starting a fresh bootstrap', async (): Promise<void> => {
    const firstBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    await db
      .update(gitProviderRegistrations)
      .set({
        pendingExpiresAt: new Date('2026-04-27T00:00:00.000Z'),
      })
      .where(eq(gitProviderRegistrations.id, firstBootstrap.registrationId));

    const secondBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const registrations: GitProviderRegistrationRowRecord[] = await db.select().from(gitProviderRegistrations);

    expect(secondBootstrap.registrationId).not.toBe(firstBootstrap.registrationId);
    expect(registrations).toHaveLength(2);
    expect(
      registrations.find(
        (registration: GitProviderRegistrationRowRecord): boolean => registration.id === firstBootstrap.registrationId,
      ),
    ).toMatchObject({
      status: 'failed',
    });
    expect(
      registrations.find(
        (registration: GitProviderRegistrationRowRecord): boolean => registration.id === secondBootstrap.registrationId,
      ),
    ).toMatchObject({
      status: 'pending',
    });
  });

  it('restarts bootstrap when a reused pending app no longer authenticates', async (): Promise<void> => {
    const firstBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(firstBootstrap.bootstrapStateId!);

    await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    mocks.assertGitHubAppStillExists.mockRejectedValueOnce(
      createMockGitHubRequestError(401, 'GitHub request failed with status 401.'),
    );

    const restartedBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const registrations: GitProviderRegistrationRowRecord[] = await db.select().from(gitProviderRegistrations);
    const states: (typeof gitProviderBootstrapStates.$inferSelect)[] = await db
      .select()
      .from(gitProviderBootstrapStates);

    expect(restartedBootstrap.registrationId).not.toBe(firstBootstrap.registrationId);
    expect(restartedBootstrap.bootstrapStateId).not.toBe(firstBootstrap.bootstrapStateId);
    expect(
      registrations.find(
        (registration: GitProviderRegistrationRowRecord): boolean => registration.id === firstBootstrap.registrationId,
      ),
    ).toMatchObject({
      bootstrapStateId: null,
      pendingExpiresAt: null,
      status: 'failed',
    });
    expect(
      registrations.find(
        (registration: GitProviderRegistrationRowRecord): boolean =>
          registration.id === restartedBootstrap.registrationId,
      ),
    ).toMatchObject({
      bootstrapStateId: restartedBootstrap.bootstrapStateId,
      status: 'pending',
    });
    const failedState: typeof gitProviderBootstrapStates.$inferSelect | undefined = states.find(
      (state: typeof gitProviderBootstrapStates.$inferSelect): boolean => state.id === firstBootstrap.bootstrapStateId,
    );
    expect(failedState?.completedAt).toBeInstanceOf(Date);
    await expect(
      readGitHubProviderBootstrapPage({
        actorPrincipalId: 'prn_git_admin',
        bootstrapStateId: firstBootstrap.bootstrapStateId!,
      }),
    ).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
  });

  it('reopens install bootstrap when an active app installation was removed', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);
    await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    await completeGitHubProviderBootstrapSetup(bootstrap.bootstrapStateId!, '98765');
    mocks.readGitHubAppInstallation.mockRejectedValueOnce(
      createMockGitHubRequestError(404, 'GitHub installation not found.'),
    );

    const reopenedBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
      returnTo: '/onboarding?method=git',
    });
    const installPage: GitHubProviderBootstrapPage = await readGitHubProviderBootstrapPage({
      actorPrincipalId: 'prn_git_admin',
      bootstrapStateId: reopenedBootstrap.bootstrapStateId!,
    });
    const registrations: GitProviderRegistrationRowRecord[] = await db.select().from(gitProviderRegistrations);
    const states: (typeof gitProviderBootstrapStates.$inferSelect)[] = await db
      .select()
      .from(gitProviderBootstrapStates);

    expect(reopenedBootstrap.registrationId).toBe(bootstrap.registrationId);
    expect(reopenedBootstrap.bootstrapStateId).not.toBe(bootstrap.bootstrapStateId);
    expect(reopenedBootstrap).toMatchObject({
      browserUrl: `https://console.example/v1/sources/git/providers/github/bootstrap/${reopenedBootstrap.bootstrapStateId}/start`,
      status: 'pending',
    });
    expect(installPage).toEqual({
      installUrl: `https://github.com/apps/compartment/installations/new?state=${reopenedBootstrap.bootstrapStateId}`,
      kind: 'install',
    });
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      appSlug: 'compartment',
      bootstrapStateId: reopenedBootstrap.bootstrapStateId,
      id: bootstrap.registrationId,
      status: 'pending',
    });
    expect(states).toHaveLength(2);
    expect(
      states.find(
        (state: typeof gitProviderBootstrapStates.$inferSelect): boolean => state.id === bootstrap.bootstrapStateId,
      )?.completedAt,
    ).not.toBeNull();
    expect(
      states.find(
        (state: typeof gitProviderBootstrapStates.$inferSelect): boolean =>
          state.id === reopenedBootstrap.bootstrapStateId,
      ),
    ).toMatchObject({
      completedAt: null,
      providerRegistrationId: bootstrap.registrationId,
      returnTo: '/onboarding?method=git',
    });
  });

  it('starts a fresh app bootstrap when the active GitHub app was deleted', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);
    await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    await completeGitHubProviderBootstrapSetup(bootstrap.bootstrapStateId!, '98765');
    mocks.assertGitHubAppStillExists.mockRejectedValueOnce(createMockGitHubRequestError(404, 'GitHub App not found.'));

    const restartedBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const registrations: GitProviderRegistrationRowRecord[] = await db.select().from(gitProviderRegistrations);

    expect(restartedBootstrap.registrationId).not.toBe(bootstrap.registrationId);
    expect(registrations).toHaveLength(2);
    expect(
      registrations.find(
        (registration: GitProviderRegistrationRowRecord): boolean => registration.id === bootstrap.registrationId,
      ),
    ).toMatchObject({
      bootstrapStateId: null,
      pendingExpiresAt: null,
      status: 'failed',
    });
    expect(
      registrations.find(
        (registration: GitProviderRegistrationRowRecord): boolean =>
          registration.id === restartedBootstrap.registrationId,
      ),
    ).toMatchObject({
      bootstrapStateId: restartedBootstrap.bootstrapStateId,
      status: 'pending',
    });
    await expect(readManifestBootstrapPage(restartedBootstrap.bootstrapStateId!)).resolves.toMatchObject({
      kind: 'manifest',
    });
  });

  it('does not fail an already active registration through the pending failure helper', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    await db
      .update(gitProviderRegistrations)
      .set({
        appId: '12345',
        appName: 'Compartment',
        appSlug: 'compartment',
        appUrl: 'https://github.com/apps/compartment',
        bootstrapStateId: null,
        pendingExpiresAt: null,
        status: 'active',
      })
      .where(eq(gitProviderRegistrations.id, bootstrap.registrationId));

    await db.transaction(async (transaction: GitProviderWriteExecutor): Promise<void> => {
      await failGitProviderRegistration(transaction, {
        id: bootstrap.registrationId,
        organizationId: gitSourceOrganizationId,
        status: 'failed',
        updatedAt: new Date('2026-04-29T00:00:00.000Z'),
      });
    });

    const [registration]: GitProviderRegistrationRowRecord[] = await db
      .select()
      .from(gitProviderRegistrations)
      .where(eq(gitProviderRegistrations.id, bootstrap.registrationId));

    expect(registration).toMatchObject({
      status: 'active',
    });
  });

  it('rejects callback completion for an unknown bootstrap nonce', async (): Promise<void> => {
    await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    await expect(completeGitHubProviderBootstrapCallback('manifest-code', 'gst_missing')).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
    expect(await db.select().from(gitProviderRegistrations)).toHaveLength(1);
    expect((await db.select().from(gitProviderRegistrations))[0]?.status).toBe('pending');
  });

  it('rejects callback completion after bootstrap state expiry', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);

    await db
      .update(gitProviderBootstrapStates)
      .set({
        expiresAt: new Date('2026-04-27T00:00:00.000Z'),
      })
      .where(eq(gitProviderBootstrapStates.id, bootstrap.bootstrapStateId!));

    await expect(completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce)).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
  });

  it('fails the pending registration when manifest exchange fails and allows bootstrap restart', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);
    mocks.exchangeGitHubAppManifestCode.mockRejectedValueOnce(new Error('manifest exchange failed'));

    await expect(completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce)).rejects.toThrow(
      'manifest exchange failed',
    );

    const failedRegistration: GitProviderRegistrationRowRecord | undefined = (
      await db.select().from(gitProviderRegistrations)
    ).find((registration: GitProviderRegistrationRowRecord): boolean => registration.id === bootstrap.registrationId);
    expect(failedRegistration).toMatchObject({
      bootstrapStateId: null,
      pendingExpiresAt: null,
      status: 'failed',
    });

    const restartedBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    expect(restartedBootstrap.registrationId).not.toBe(bootstrap.registrationId);
    expect(restartedBootstrap.status).toBe('pending');
  });

  it('fails the pending registration when setup activation persistence fails and allows bootstrap restart', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);
    await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    persistenceMocks.activatePersistedGitHubProviderRegistration.mockRejectedValueOnce(new Error('activation failed'));

    await expect(completeGitHubProviderBootstrapSetup(bootstrap.bootstrapStateId!, '98765')).rejects.toThrow(
      'activation failed',
    );

    const failedRegistration: GitProviderRegistrationRowRecord | undefined = (
      await db.select().from(gitProviderRegistrations)
    ).find((registration: GitProviderRegistrationRowRecord): boolean => registration.id === bootstrap.registrationId);
    expect(failedRegistration).toMatchObject({
      bootstrapStateId: null,
      pendingExpiresAt: null,
      status: 'failed',
    });

    const restartedBootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    expect(restartedBootstrap.registrationId).not.toBe(bootstrap.registrationId);
    expect(restartedBootstrap.status).toBe('pending');
  });

  it('fails bootstrap setup terminally when the installation account does not match the requested owner', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);
    await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    mocks.readGitHubAppInstallation.mockResolvedValueOnce({
      accountLogin: 'other',
      accountType: 'Organization',
      installationId: '98765',
    });

    await expect(completeGitHubProviderBootstrapSetup(bootstrap.bootstrapStateId!, '98765')).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
      message: 'GitHub App installation account does not match the requested owner.',
    });

    const [failedRegistration]: GitProviderRegistrationRowRecord[] = await db
      .select()
      .from(gitProviderRegistrations)
      .where(eq(gitProviderRegistrations.id, bootstrap.registrationId));
    const [completedState] = await db
      .select()
      .from(gitProviderBootstrapStates)
      .where(eq(gitProviderBootstrapStates.id, bootstrap.bootstrapStateId!));

    expect(failedRegistration).toMatchObject({
      bootstrapStateId: null,
      status: 'failed',
    });
    expect(completedState?.completedAt).not.toBeNull();
  });

  it('does not reactivate a registration that lost the pending race before setup completion', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);
    await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    const actualBootstrapPersistence: typeof GitSourceBootstrapPersistence = await vi.importActual<
      typeof GitSourceBootstrapPersistence
    >('../src/services/git-source/git-source-bootstrap.persistence');
    persistenceMocks.activatePersistedGitHubProviderRegistration.mockImplementationOnce(
      async (
        transaction: GitProviderWriteExecutor,
        registration: Pick<GitProviderRegistrationRow, 'id' | 'organizationId'>,
        installation: GitHubAppInstallation,
        now: Date,
      ): Promise<void> => {
        await failGitProviderRegistration(transaction, {
          id: registration.id,
          organizationId: registration.organizationId,
          status: 'failed',
          updatedAt: now,
        });
        await actualBootstrapPersistence.activatePersistedGitHubProviderRegistration(
          transaction,
          registration,
          installation,
          now,
        );
      },
    );

    await expect(completeGitHubProviderBootstrapSetup(bootstrap.bootstrapStateId!, '98765')).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
      message: 'Git provider registration is no longer pending.',
    });

    const [registration]: GitProviderRegistrationRowRecord[] = await db
      .select()
      .from(gitProviderRegistrations)
      .where(eq(gitProviderRegistrations.id, bootstrap.registrationId));
    const [state] = await db
      .select()
      .from(gitProviderBootstrapStates)
      .where(eq(gitProviderBootstrapStates.id, bootstrap.bootstrapStateId!));

    expect(registration).toMatchObject({
      bootstrapStateId: null,
      pendingExpiresAt: null,
      status: 'failed',
    });
    expect(state?.completedAt).not.toBeNull();
  });

  it('rejects bootstrap page and callback replay after successful completion', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });
    const page: GitHubProviderBootstrapManifestPage = await readManifestBootstrapPage(bootstrap.bootstrapStateId!);

    await completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce);
    await completeGitHubProviderBootstrapSetup(bootstrap.bootstrapStateId!, '98765');

    await expect(
      readGitHubProviderBootstrapPage({
        actorPrincipalId: 'prn_git_admin',
        bootstrapStateId: bootstrap.bootstrapStateId!,
      }),
    ).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
    await expect(completeGitHubProviderBootstrapCallback('manifest-code', page.stateNonce)).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
  });

  it('rejects an invalid bootstrap state id', async (): Promise<void> => {
    await expect(
      readGitHubProviderBootstrapStatus({
        actor: createGitSourceActor(),
        organizationId: gitSourceOrganizationId,
        bootstrapStateId: 'gps_missing',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
  });

  it('rejects bootstrap status access for a different principal', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    await expect(
      readGitHubProviderBootstrapStatus({
        actor: {
          ...createGitSourceActor(),
          principalId: 'prn_git_reviewer',
        },
        organizationId: gitSourceOrganizationId,
        bootstrapStateId: bootstrap.bootstrapStateId!,
      }),
    ).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
  });

  it('rejects bootstrap page access for a different principal', async (): Promise<void> => {
    const bootstrap: GitHubProviderBootstrapView = await startGitHubProviderBootstrap({
      actor: createGitSourceActor(),
      organizationId: gitSourceOrganizationId,
      compartmentUrl: 'https://console.example',
      providerHost: 'github.com',
      repositoryOwner: 'acme',
    });

    await expect(
      readGitHubProviderBootstrapPage({
        actorPrincipalId: 'prn_git_reviewer',
        bootstrapStateId: bootstrap.bootstrapStateId!,
      }),
    ).rejects.toMatchObject({
      code: 'git_source_bootstrap_invalid',
    });
  });
});

function createGitSourceActor(): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_123',
    },
    memberships: [
      {
        role: 'admin',
        scopeId: gitSourceOrganizationId,
        scopeType: 'organization',
      },
    ],
    principalEmail: 'git-admin@example.com',
    principalId: 'prn_git_admin',
    principalType: 'user',
    sessionId: 'ses_git_admin',
    tokenHash: 'hashed-git-admin',
  };
}

async function readManifestBootstrapPage(bootstrapStateId: string): Promise<GitHubProviderBootstrapManifestPage> {
  const page: GitHubProviderBootstrapPage = await readGitHubProviderBootstrapPage({
    actorPrincipalId: 'prn_git_admin',
    bootstrapStateId,
  });
  if (page.kind !== 'manifest') {
    throw new Error('Expected manifest bootstrap page.');
  }
  return page;
}

async function installPendingBootstrapInsertBlocker(): Promise<void> {
  await removePendingBootstrapInsertBlocker();
  await pool.query(`
    create or replace function ${blockPendingBootstrapInsertFunctionName}()
    returns trigger
    language plpgsql
    as $function$
    begin
      perform pg_advisory_lock(${pendingBootstrapInsertLockNamespace}, ${pendingBootstrapInsertLockKey});
      perform pg_advisory_unlock(${pendingBootstrapInsertLockNamespace}, ${pendingBootstrapInsertLockKey});
      return new;
    end;
    $function$;
  `);
  await pool.query(`
    create trigger ${blockPendingBootstrapInsertTriggerName}
    before insert on git_provider_registrations
    for each row
    when (
      new.provider_type = 'github_app'
      and new.provider_host = 'github.com'
      and new.repository_owner = 'acme'
      and new.status = 'pending'
    )
    execute function ${blockPendingBootstrapInsertFunctionName}();
  `);
}

async function removePendingBootstrapInsertBlocker(): Promise<void> {
  await pool.query(`drop trigger if exists ${blockPendingBootstrapInsertTriggerName} on git_provider_registrations`);
  await pool.query(`drop function if exists ${blockPendingBootstrapInsertFunctionName}()`);
}

async function waitForPendingBootstrapInsertWaiters(expectedWaiterCount: number): Promise<void> {
  const startedAtMs: number = Date.now();

  while (Date.now() - startedAtMs < concurrentInsertWaitTimeoutMs) {
    if ((await readPendingBootstrapInsertWaiterCount()) === expectedWaiterCount) {
      return;
    }
    await waitForConcurrentDatabaseWork();
  }

  throw new Error(`Timed out waiting for ${expectedWaiterCount} pending bootstrap insert waiters.`);
}

async function readPendingBootstrapInsertWaiterCount(): Promise<number> {
  const result: { rows: { value: number }[] } = await pool.query(
    `
      select count(*)::int as value
      from pg_locks
      where locktype = 'advisory'
        and database = (select oid from pg_database where datname = current_database())
        and classid = $1
        and objid = $2
        and granted = false
    `,
    [pendingBootstrapInsertLockNamespace, pendingBootstrapInsertLockKey],
  );

  return result.rows[0]?.value ?? 0;
}

function createMockGitHubRequestError(status: number, message: string): Error & { status: number } {
  const error: Error & { status: number } = Object.assign(new Error(message), {
    name: 'GitHubRequestError',
    status,
  });
  return error;
}
