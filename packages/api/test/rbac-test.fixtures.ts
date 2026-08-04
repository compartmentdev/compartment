import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Pool } from 'pg';
import {
  listCompartmentRolePermissions,
  type CompartmentMembershipRole,
  type PermissionKey,
} from '@compartment/contracts';
import { and, eq } from 'drizzle-orm';
import {
  deriveProcessScopedDatabaseUrl,
  ensureDatabaseExists,
  readDatabaseTestMode,
  resetDatabase,
  runCompartmentApiMigrations,
} from '@compartment/test-support';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  accessRoles,
  authSessions,
  environments,
  localCredentials,
  organizationMemberships,
  organizations,
  principals,
  projects,
} from '../src/db/schema';
import { hashToken } from '../src/lib/tokens';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { createOrganizationMembershipWithExecutor } from '../src/queries/organization-memberships.query';
import { createAccessAssignmentWithExecutor } from '../src/queries/rbac-assignments.query';
import type { CreateAccessAssignmentInput, RbacTransaction } from '../src/queries/rbac.query.types';
import { addAccessGroupMembershipWithExecutor, createAccessGroupWithExecutor } from '../src/queries/rbac-groups.query';
import { createAccessRoleWithExecutor } from '../src/queries/rbac-roles.query';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import { createOrganizationMemberSession } from './api-auth-session-test.fixtures';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();

export interface RbacTestHarness {
  apiConfig: ApiConfig;
  databaseUrl: string;
  db: Database;
  pool: Pool;
}

export function createRbacTestHarness(scope: string): RbacTestHarness {
  const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, scope);
  const pool: Pool = createDatabasePool(databaseUrl);

  return {
    apiConfig: createRbacApiConfig(databaseUrl, scope),
    databaseUrl,
    db: createDatabase(pool),
    pool,
  };
}

export async function ensureRbacTestHarness(harness: RbacTestHarness): Promise<void> {
  await ensureDatabaseExists(harness.databaseUrl);
}

export async function resetRbacTestHarness(harness: RbacTestHarness): Promise<void> {
  await resetDatabase(harness.databaseUrl);
  await runCompartmentApiMigrations(harness.databaseUrl);
}

export function configureRbacTestRuntime(harness: RbacTestHarness): void {
  configureApiRuntime({
    config: harness.apiConfig,
    db: harness.db,
  });
}

export function clearRbacTestHarnessRuntime(): void {
  clearApiRuntime();
}

export async function closeRbacTestHarness(harness: RbacTestHarness): Promise<void> {
  await harness.pool.end();
}

export async function seedOrganization(
  harness: RbacTestHarness,
  input: { id: string; name?: string; slug?: string },
): Promise<void> {
  await harness.db.insert(organizations).values({
    id: input.id,
    name: input.name ?? 'Acme Dev',
    slug: input.slug ?? 'acme-dev',
  });
}

export async function seedPrincipal(
  harness: RbacTestHarness,
  input: { email: string; id: string; passwordHash?: string | null },
): Promise<void> {
  await harness.db.insert(principals).values({
    email: input.email,
    id: input.id,
    type: 'user',
  });
  await harness.db.insert(localCredentials).values({
    passwordHash: input.passwordHash ?? null,
    principalId: input.id,
    updatedAt: new Date('2026-05-05T00:00:00.000Z'),
  });
}

export async function seedOrganizationMembership(
  harness: RbacTestHarness,
  input: { blockedAt?: Date | null; id: string; organizationId: string; principalId: string },
): Promise<void> {
  await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
    await createOrganizationMembershipWithExecutor(tx, {
      id: input.id,
      organizationId: input.organizationId,
      principalId: input.principalId,
    });
    if (input.blockedAt !== undefined) {
      await tx
        .update(organizationMemberships)
        .set({ blockedAt: input.blockedAt })
        .where(eq(organizationMemberships.id, input.id));
    }
  });
}

export async function seedMemberSession(
  harness: RbacTestHarness,
  input: { email: string; organizationId: string; principalId: string; sessionToken: string },
): Promise<void> {
  await createOrganizationMemberSession({
    assignRole: false,
    db: harness.db,
    email: input.email,
    organizationId: input.organizationId,
    principalId: input.principalId,
    sessionId: `ses_${input.principalId}`,
    sessionSecret: harness.apiConfig.sessionSecret,
    sessionToken: input.sessionToken,
    role: 'viewer',
  });
}

export async function seedProject(
  harness: RbacTestHarness,
  input: { id: string; name: string; organizationId: string },
): Promise<void> {
  await harness.db.insert(projects).values({
    id: input.id,
    name: input.name,
    organizationId: input.organizationId,
    updatedAt: new Date('2026-05-05T00:00:00.000Z'),
  });
}

export async function seedEnvironment(
  harness: RbacTestHarness,
  input: { id: string; name: string; projectId: string },
): Promise<void> {
  await harness.db.insert(environments).values({
    id: input.id,
    name: input.name,
    projectId: input.projectId,
    updatedAt: new Date('2026-05-05T00:00:00.000Z'),
  });
}

export async function seedSystemRoles(harness: RbacTestHarness, organizationId: string): Promise<void> {
  await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
    for (const roleName of systemRoleNames) {
      await createAccessRoleWithExecutor(tx, {
        description: null,
        id: `rol_${organizationId}_${roleName}`,
        kind: 'system',
        name: roleName,
        organizationId,
        permissionKeys: listCompartmentRolePermissions(roleName),
        updatedAt: new Date('2026-05-05T00:00:00.000Z'),
      });
    }
  });
}

export async function seedCustomRole(
  harness: RbacTestHarness,
  input: { id: string; name: string; organizationId: string; permissionKeys: PermissionKey[] },
): Promise<void> {
  await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
    await createAccessRoleWithExecutor(tx, {
      description: null,
      id: input.id,
      kind: 'custom',
      name: input.name,
      organizationId: input.organizationId,
      permissionKeys: input.permissionKeys,
      updatedAt: new Date('2026-05-05T00:00:00.000Z'),
    });
  });
}

export async function seedGroup(
  harness: RbacTestHarness,
  input: { id: string; name: string; organizationId: string },
): Promise<void> {
  await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
    await createAccessGroupWithExecutor(tx, {
      description: null,
      id: input.id,
      name: input.name,
      organizationId: input.organizationId,
      updatedAt: new Date('2026-05-05T00:00:00.000Z'),
    });
  });
}

export async function seedGroupMembership(
  harness: RbacTestHarness,
  input: { groupId: string; id: string; principalId: string },
): Promise<void> {
  await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
    await addAccessGroupMembershipWithExecutor(tx, input);
  });
}

export async function seedAssignment(harness: RbacTestHarness, input: CreateAccessAssignmentInput): Promise<void> {
  await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
    await createAccessAssignmentWithExecutor(tx, input);
  });
}

export async function seedAuthSession(
  harness: RbacTestHarness,
  input: { organizationId: string; principalId: string; sessionId: string; sessionToken: string },
): Promise<void> {
  await harness.db.insert(authSessions).values({
    authMethodKind: 'password',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    id: input.sessionId,
    organizationId: input.organizationId,
    principalId: input.principalId,
    tokenHash: hashToken(input.sessionToken, harness.apiConfig.sessionSecret),
  });
}

export async function findRoleIdByName(
  harness: RbacTestHarness,
  organizationId: string,
  roleName: string,
): Promise<string> {
  const rows: { id: string }[] = await harness.db
    .select({ id: accessRoles.id })
    .from(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.name, roleName)));
  const role: { id: string } | undefined = rows[0];
  if (role === undefined) {
    throw new Error(`Missing role ${roleName}.`);
  }

  return role.id;
}

const systemRoleNames: readonly CompartmentMembershipRole[] = ['admin', 'deployer', 'readonly', 'viewer'];

function createRbacApiConfig(databaseUrl: string, scope: string): ApiConfig {
  return {
    builderProfileDigest: 'sha256:' + 'e'.repeat(64),
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
    sourceArchiveDirectory: join(tmpdir(), `compartment-${scope}-source-archives`),
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: `/tmp/compartment/${scope}-system-api.sock`,
    systemToken: 'test-system-token',
    throttle: defaultApiAuthThrottleConfig,
    trustedOutboundHosts: ['idp.example.com'],
    tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
    variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
  };
}
