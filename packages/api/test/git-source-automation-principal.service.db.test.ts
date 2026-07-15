import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type CompartmentMembershipRole } from '@compartment/contracts';
import {
  deriveProcessScopedDatabaseUrl,
  ensureDatabaseExists,
  readDatabaseTestMode,
  resetDatabase,
} from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  accessAssignments,
  accessRoles,
  gitProviderRegistrations,
  localCredentials,
  organizationMemberships,
  organizations,
  principals,
  sources,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { findSourceById } from '../src/queries/source.query';
import type { SourceMutationTransaction, SourceRow } from '../src/queries/source.query.types';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import {
  blockSourceAutomationPrincipalAccessWithExecutor,
  ensureSourceAutomationPrincipalWithExecutor,
} from '../src/services/git-source/git-source-automation-principal.service';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from '../src/services/rbac-seed.service';
import { runCompartmentApiMigrations as runApiMigrations } from '@compartment/test-support';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'git_source_automation_principal_service');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  controlPlaneHost: 'compartment.localhost',
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
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('55'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('git source automation principal service', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureDatabaseExists(databaseUrl);
  });

  beforeEach(async (): Promise<void> => {
    await resetDatabase(databaseUrl);
    await runApiMigrations(databaseUrl);
    configureApiRuntime({
      config: apiConfig,
      db,
    });
    await seedAutomationPrincipalScope();
  });

  afterEach((): void => {
    clearApiRuntime();
  });

  afterAll(async (): Promise<void> => {
    await pool.end();
  });

  it('creates and stores the source automation principal on first ensure', async (): Promise<void> => {
    const source: SourceRow = (await findSourceById('src_123'))!;

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await ensureSourceAutomationPrincipalWithExecutor(transaction, source);
    });

    const updatedSource: SourceRow = (await findSourceById('src_123'))!;
    const automationMembership: (typeof organizationMemberships.$inferSelect)[] = await db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.principalId, updatedSource.automationPrincipalId!));

    expect(updatedSource.automationPrincipalId).toBe('prn_git_src_123');
    expect(requireFirst(automationMembership, 'automation membership')).toMatchObject({
      blockedAt: null,
      organizationId: 'org_123',
    });
    await expect(readAssignedRoleNames(updatedSource.automationPrincipalId!)).resolves.toContain('deployer');
  });

  it('restores an existing blocked automation membership on ensure', async (): Promise<void> => {
    await db.insert(principals).values({
      email: 'git-source+src_123@compartment.internal',
      id: 'prn_git_auto',
      type: 'automation',
    });
    await db.insert(organizationMemberships).values({
      blockedAt: new Date('2026-05-01T11:00:00.000Z'),
      id: 'mem_git_auto',
      principalId: 'prn_git_auto',
      organizationId: 'org_123',
    });
    await assignSystemRole('prn_git_auto', 'viewer');
    await db.update(sources).set({ automationPrincipalId: 'prn_git_auto' }).where(eq(sources.id, 'src_123'));

    const source: SourceRow = (await findSourceById('src_123'))!;
    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await blockSourceAutomationPrincipalAccessWithExecutor(transaction, source, new Date('2026-05-01T12:00:00.000Z'));
      await ensureSourceAutomationPrincipalWithExecutor(transaction, source);
    });

    const restoredMembership: typeof organizationMemberships.$inferSelect = requireFirst(
      await db.select().from(organizationMemberships).where(eq(organizationMemberships.principalId, 'prn_git_auto')),
      'restored automation membership',
    );

    expect(restoredMembership.blockedAt).toBeNull();
    await expect(readAssignedRoleNames('prn_git_auto')).resolves.toContain('deployer');
  });
});

function requireFirst<T>(rows: readonly T[], label: string): T {
  const first: T | undefined = rows[0];
  if (first === undefined) {
    throw new Error(`Expected ${label}.`);
  }

  return first;
}

async function seedAutomationPrincipalScope(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
  await db.insert(principals).values({
    email: 'admin@example.com',
    id: 'prn_admin',
    type: 'user',
  });
  await db.insert(localCredentials).values({
    passwordHash: 'admin-password-hash',
    principalId: 'prn_admin',
  });
  await db.insert(organizationMemberships).values({
    id: 'mem_admin',
    organizationId: 'org_123',
    principalId: 'prn_admin',
  });
  await assignSystemRole('prn_admin', 'admin');
  await db.insert(gitProviderRegistrations).values({
    callbackUrl: 'https://console.example.com/callback',
    createdByPrincipalId: 'prn_admin',
    id: 'gpr_123',
    providerHost: 'github.example.com',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    webhookUrl:
      'https://console.example.com/v1/sources/git/providers/github/organizations/org_123/registrations/gpr_123/webhook',
    updatedAt: new Date('2026-05-01T09:00:00.000Z'),
  });
  await db.insert(sources).values({
    automationPrincipalId: null,
    autoAdoptNewApps: true,
    createdByPrincipalId: 'prn_admin',
    defaultAutoDeployEnabled: true,
    defaultBranchName: 'main',
    defaultEnvironmentName: 'production',
    displayName: 'Acme Git Source',
    id: 'src_123',
    organizationId: 'org_123',
    providerHost: 'github.example.com',
    providerInstallationId: 'inst_123',
    providerRegistrationId: 'gpr_123',
    repositoryCloneUrl: 'https://github.example.com/acme/platform.git',
    repositoryExternalId: 'repo_123',
    repositoryName: 'platform',
    repositoryOwner: 'acme',
    status: 'active',
    syncBranchName: 'main',
    type: 'git',
    updatedAt: new Date('2026-05-01T09:00:00.000Z'),
  });
}

async function assignSystemRole(principalId: string, roleName: CompartmentMembershipRole): Promise<void> {
  await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
    await assignOrganizationSystemRoleToPrincipalWithExecutor(transaction, 'org_123', principalId, roleName);
  });
}

async function readAssignedRoleNames(principalId: string): Promise<string[]> {
  const rows: { name: string }[] = await db
    .select({ name: accessRoles.name })
    .from(accessAssignments)
    .innerJoin(accessRoles, eq(accessRoles.id, accessAssignments.roleId))
    .where(eq(accessAssignments.subjectId, principalId));

  return rows.map((row: { name: string }): string => row.name);
}
