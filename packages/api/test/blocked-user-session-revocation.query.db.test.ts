import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  appAccessSessions,
  authSessions,
  buildArtifacts,
  deploymentCustomDomains,
  deploymentRoutes,
  deploymentRuns,
  deployments,
  environments,
  operations,
  organizationMemberships,
  organizations,
  principals,
  projectServices,
  projects,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { revokeBlockedOrganizationUserAppAccessSessions } from '../src/queries/app-access.query';
import { listActiveAuthenticationSessionIdsForBlockedOrganizationUser } from '../src/queries/blocked-organization-user-sessions.query';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

interface CreateAuthSessionInput {
  expiresAt?: Date | undefined;
  id: string;
  organizationId: string | null;
  principalId: string;
  revokedAt?: Date | null | undefined;
}

interface CreateDeploymentInput {
  host?: string | undefined;
  isActive?: boolean | undefined;
  organizationId: string;
  prefix: string;
  subdomain: string;
}

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'blocked_user_session_revocation');
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
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('blocked user session revocation db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: seedOrganizationsAndPrincipals,
  });

  it('lists org-scoped sessions and global sessions when the blocked user has no active memberships', async (): Promise<void> => {
    await createBlockedMembership('mem_blocked', 'prn_blocked', 'org_123');
    await createMembership('mem_active', 'prn_active', 'org_456');
    await createAuthSession({ id: 'ses_org_scoped', organizationId: 'org_123', principalId: 'prn_blocked' });
    await createAuthSession({ id: 'ses_global', organizationId: null, principalId: 'prn_blocked' });
    await createAuthSession({ id: 'ses_other_org', organizationId: 'org_456', principalId: 'prn_blocked' });
    await createAuthSession({ id: 'ses_other_principal_global', organizationId: null, principalId: 'prn_active' });
    await createAuthSession({
      expiresAt: new Date('2026-04-29T09:00:00.000Z'),
      id: 'ses_expired',
      organizationId: 'org_123',
      principalId: 'prn_blocked',
    });

    await expect(
      listActiveAuthenticationSessionIdsForBlockedOrganizationUser({
        activeAt: new Date('2026-04-29T10:00:00.000Z'),
        organizationId: 'org_123',
        principalId: 'prn_blocked',
      }),
    ).resolves.toEqual(['ses_org_scoped', 'ses_global']);
  });

  it('revokes app access sessions for active routes owned by the blocked organization', async (): Promise<void> => {
    await createAuthSession({ id: 'ses_global', organizationId: null, principalId: 'prn_blocked' });
    await createAuthSession({ id: 'ses_other_principal', organizationId: null, principalId: 'prn_active' });
    await createDeployment({
      host: 'custom.customer.example.com',
      organizationId: 'org_123',
      prefix: 'billing',
      subdomain: 'billing',
    });
    await createDeployment({ organizationId: 'org_456', prefix: 'beta', subdomain: 'beta' });
    await createDeployment({ isActive: false, organizationId: 'org_123', prefix: 'old', subdomain: 'old' });
    await createAppAccessSession('aps_canonical', 'ses_global', 'billing.localhost');
    await createAppAccessSession('aps_custom', 'ses_global', 'custom.customer.example.com');
    await createAppAccessSession('aps_other_org', 'ses_global', 'beta.localhost');
    await createAppAccessSession('aps_inactive_route', 'ses_global', 'old.localhost');
    await createAppAccessSession('aps_other_principal', 'ses_other_principal', 'billing.localhost');
    await createAppAccessSession('aps_expired', 'ses_global', 'billing.localhost', {
      expiresAt: new Date('2026-04-29T09:00:00.000Z'),
    });

    const authSessionIds: string[] = await revokeBlockedOrganizationUserAppAccessSessions({
      baseDomain: 'localhost',
      organizationId: 'org_123',
      principalId: 'prn_blocked',
      revokedAt: new Date('2026-04-29T10:00:00.000Z'),
    });

    expect(authSessionIds).toEqual(['ses_global']);
    await expect(readAppAccessRevokedAt('aps_canonical')).resolves.toEqual(new Date('2026-04-29T10:00:00.000Z'));
    await expect(readAppAccessRevokedAt('aps_custom')).resolves.toEqual(new Date('2026-04-29T10:00:00.000Z'));
    await expect(readAppAccessRevokedAt('aps_other_org')).resolves.toBeNull();
    await expect(readAppAccessRevokedAt('aps_inactive_route')).resolves.toBeNull();
    await expect(readAppAccessRevokedAt('aps_other_principal')).resolves.toBeNull();
    await expect(readAppAccessRevokedAt('aps_expired')).resolves.toBeNull();
  });
});

async function seedOrganizationsAndPrincipals(): Promise<void> {
  await db.insert(organizations).values([
    { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
    { id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' },
  ]);
  await db.insert(principals).values([
    { email: 'blocked@example.com', id: 'prn_blocked', type: 'user' },
    { email: 'active@example.com', id: 'prn_active', type: 'user' },
  ]);
}

async function createMembership(id: string, principalId: string, organizationId: string): Promise<void> {
  await db.insert(organizationMemberships).values({
    id,
    organizationId,
    principalId,
  });
}

async function createBlockedMembership(id: string, principalId: string, organizationId: string): Promise<void> {
  await createMembership(id, principalId, organizationId);
  await db
    .update(organizationMemberships)
    .set({ blockedAt: new Date('2026-04-29T09:00:00.000Z') })
    .where(eq(organizationMemberships.id, id));
}

async function createAuthSession(input: CreateAuthSessionInput): Promise<void> {
  await db.insert(authSessions).values({
    authMethodKind: 'password',
    expiresAt: input.expiresAt ?? new Date('2099-01-01T00:00:00.000Z'),
    id: input.id,
    oidcProviderId: null,
    organizationId: input.organizationId,
    principalId: input.principalId,
    revokedAt: input.revokedAt ?? null,
    tokenHash: `${input.id}-token-hash`,
  });
}

async function createDeployment(input: CreateDeploymentInput): Promise<void> {
  await db.insert(projects).values({
    id: `prj_${input.prefix}`,
    name: input.prefix,
    organizationId: input.organizationId,
  });
  await db.insert(projectServices).values({
    id: `svc_${input.prefix}`,
    kind: 'web',
    name: 'web',
    path: '.',
    projectId: `prj_${input.prefix}`,
  });
  await db.insert(environments).values({
    id: `env_${input.prefix}`,
    name: 'production',
    projectId: `prj_${input.prefix}`,
  });
  await db.insert(operations).values({
    id: `op_${input.prefix}`,
    status: 'succeeded',
    summary: 'Deployed app',
    targetId: input.prefix,
    targetType: 'deployment',
    type: 'deployment.create',
  });
  await db.insert(buildArtifacts).values({
    id: `bar_${input.prefix}`,
    imageRepository: `repo/${input.prefix}`,
    projectId: `prj_${input.prefix}`,
    projectServiceId: `svc_${input.prefix}`,
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: `sha256:${input.prefix}`,
  });
  await db.insert(deploymentRuns).values({
    environmentId: `env_${input.prefix}`,
    id: `drn_${input.prefix}`,
    label: null,
    triggerType: 'manual',
  });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: `bar_${input.prefix}`,
    deploymentRunId: `drn_${input.prefix}`,
    environmentId: `env_${input.prefix}`,
    health: 'healthy',
    id: `dep_${input.prefix}`,
    isActive: input.isActive ?? true,
    operationId: `op_${input.prefix}`,
    projectServiceId: `svc_${input.prefix}`,
    promotionStage: 'active',
    resolvedPortsJson: '[3000]',
    resolvedReadinessJson: '[]',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: 'running',
  });
  await db.insert(deploymentRoutes).values({
    accessScopeId: input.organizationId,
    accessScopeType: 'organization',
    deploymentId: `dep_${input.prefix}`,
    id: `dpr_${input.prefix}`,
    subdomain: input.subdomain,
  });
  if (input.host !== undefined) {
    await db.insert(deploymentCustomDomains).values({
      edgeRoutingEnabled: true,
      environmentId: `env_${input.prefix}`,
      host: input.host,
      id: `dcd_${input.prefix}`,
      ownershipStatus: 'valid',
      projectServiceId: `svc_${input.prefix}`,
      routingStatus: 'valid',
      verificationTokenHash: `token_${input.prefix}`,
    });
  }
}

async function createAppAccessSession(
  id: string,
  authSessionId: string,
  host: string,
  overrides: { expiresAt?: Date | undefined } = {},
): Promise<void> {
  await db.insert(appAccessSessions).values({
    authSessionId,
    expiresAt: overrides.expiresAt ?? new Date('2099-01-01T00:00:00.000Z'),
    host,
    id,
    tokenHash: `${id}-token-hash`,
  });
}

async function readAppAccessRevokedAt(appSessionId: string): Promise<Date | null> {
  const rows: { revokedAt: Date | null }[] = await db
    .select({ revokedAt: appAccessSessions.revokedAt })
    .from(appAccessSessions)
    .where(eq(appAccessSessions.id, appSessionId));

  return rows[0]?.revokedAt ?? null;
}
