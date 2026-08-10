import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  localCredentials,
  organizationMemberships,
  organizations,
  principals,
  ssoOidcIdentities,
  ssoOidcProviders,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { listOrganizationUsersPage } from '../src/queries/organization-users-list.query';
import type { OrganizationUsersListPageResult } from '../src/queries/organization-users-list.query.types';
import type { OrganizationUserRow } from '../src/queries/organization-users.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const organizationUsersListQueryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'organization_users_list_query',
);
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'compartment.localhost',
  databaseUrl: organizationUsersListQueryDatabaseUrl,
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
  signupEnabled: false,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(organizationUsersListQueryDatabaseUrl);
const db: Database = createDatabase(pool);

describe('organization users list db query', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: organizationUsersListQueryDatabaseUrl,
    db,
    pool,
    setup: seedOrganizationUsers,
  });

  it('filters by status text and orders invited users by email in SQL', async (): Promise<void> => {
    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: ' invited ',
      sort: 'asc',
    });

    expect(result.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalItems: 2,
      totalPages: 1,
    });
    expect(result.users.map((user: OrganizationUserRow): string => user.email)).toEqual([
      'readonly@example.com',
      'viewer@example.com',
    ]);
  });

  it('keeps search results scoped to the requested organization', async (): Promise<void> => {
    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: 'outsider',
      sort: 'asc',
    });

    expect(result.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalItems: 0,
      totalPages: 1,
    });
    expect(result.users).toEqual([]);
  });

  it('keeps pagination metadata after SQL-backed status ordering', async (): Promise<void> => {
    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'status',
      organizationId: 'org_123',
      page: 2,
      perPage: 2,
      sort: 'desc',
    });

    expect(result.pagination).toEqual({
      page: 2,
      perPage: 2,
      totalItems: 4,
      totalPages: 2,
    });
    expect(result.users.map((user: OrganizationUserRow): string => user.email)).toEqual([
      'admin@example.com',
      'deployer@example.com',
    ]);
  });

  it('orders by email in SQL and clamps pages past the end', async (): Promise<void> => {
    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 3,
      perPage: 2,
      sort: 'desc',
    });

    expect(result.pagination).toEqual({
      page: 2,
      perPage: 2,
      totalItems: 4,
      totalPages: 2,
    });
    expect(result.users.map((user: OrganizationUserRow): string => user.email)).toEqual([
      'deployer@example.com',
      'admin@example.com',
    ]);
  });

  it('treats percent wildcards as literal search text', async (): Promise<void> => {
    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: '%',
      sort: 'asc',
    });

    expect(result.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalItems: 0,
      totalPages: 1,
    });
    expect(result.users).toEqual([]);
  });

  it('treats underscore wildcards as literal search text', async (): Promise<void> => {
    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: '_',
      sort: 'asc',
    });

    expect(result.pagination).toEqual({
      page: 1,
      perPage: 10,
      totalItems: 0,
      totalPages: 1,
    });
    expect(result.users).toEqual([]);
  });

  it('treats SSO-linked users without local passwords as active', async (): Promise<void> => {
    await createSsoProvider();
    await db.insert(ssoOidcIdentities).values({
      id: 'soi_viewer',
      lastLoginAt: new Date('2026-04-28T10:00:00.000Z'),
      principalId: 'prn_viewer',
      providerId: 'sop_123',
      subject: 'subject_viewer',
    });

    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: 'active',
      sort: 'asc',
    });

    expect(result.users.map((user: OrganizationUserRow): string => user.email)).toContain('viewer@example.com');
  });

  it('does not treat cross-organization SSO identities as active in this organization', async (): Promise<void> => {
    await createSsoProvider('org_456', 'sop_456');
    await db.insert(ssoOidcIdentities).values({
      id: 'soi_viewer_other_org',
      lastLoginAt: new Date('2026-04-28T10:00:00.000Z'),
      principalId: 'prn_viewer',
      providerId: 'sop_456',
      subject: 'subject_viewer_other_org',
    });

    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: 'active',
      sort: 'asc',
    });

    expect(result.users.map((user: OrganizationUserRow): string => user.email)).not.toContain('viewer@example.com');
  });

  it('keeps blocked users listable and searchable by access state', async (): Promise<void> => {
    await db
      .update(organizationMemberships)
      .set({ blockedAt: new Date('2026-04-30T10:00:00.000Z') })
      .where(eq(organizationMemberships.principalId, 'prn_viewer'));

    const result: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: 'blocked',
      sort: 'asc',
    });

    expect(result.users.map((user: OrganizationUserRow): string => user.email)).toEqual(['viewer@example.com']);
    expect(result.users[0]?.blockedAt).toEqual(new Date('2026-04-30T10:00:00.000Z'));
  });

  it('lists automation principals as active system accounts and matches automation search text', async (): Promise<void> => {
    await insertOrganizationUser({
      email: 'git-source+src_123@compartment.internal',
      passwordHash: null,
      principalId: 'prn_git_source',
      type: 'automation',
    });

    const systemResult: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: 'system',
      sort: 'asc',
    });
    const activeResult: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: 'active',
      sort: 'asc',
    });

    expect(systemResult.users).toHaveLength(1);
    expect(systemResult.users[0]).toMatchObject({
      email: 'git-source+src_123@compartment.internal',
      type: 'automation',
    });
    expect(activeResult.users.map((user: OrganizationUserRow): string => user.email)).toContain(
      'git-source+src_123@compartment.internal',
    );
  });

  it('filters requested user types before counting, searching, and paginating', async (): Promise<void> => {
    await insertOrganizationUser({
      email: 'git-source+src_123@compartment.internal',
      passwordHash: null,
      principalId: 'prn_git_source',
      type: 'automation',
    });

    const humanResult: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: 'active',
      sort: 'asc',
      type: 'user',
    });
    const automationResult: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 1,
      perPage: 10,
      search: 'system',
      sort: 'asc',
      type: 'automation',
    });
    const humanPaginationResult: OrganizationUsersListPageResult = await listOrganizationUsersPage({
      orderBy: 'email',
      organizationId: 'org_123',
      page: 2,
      perPage: 2,
      sort: 'desc',
      type: 'user',
    });

    expect(humanResult.pagination.totalItems).toBe(2);
    expect(humanResult.users.map((user: OrganizationUserRow): string => user.email)).toEqual([
      'admin@example.com',
      'deployer@example.com',
    ]);
    expect(automationResult.pagination.totalItems).toBe(1);
    expect(automationResult.users.map((user: OrganizationUserRow): string => user.email)).toEqual([
      'git-source+src_123@compartment.internal',
    ]);
    expect(humanPaginationResult.pagination).toEqual({
      page: 2,
      perPage: 2,
      totalItems: 4,
      totalPages: 2,
    });
    expect(humanPaginationResult.users.map((user: OrganizationUserRow): string => user.email)).toEqual([
      'deployer@example.com',
      'admin@example.com',
    ]);
  });
});

interface InsertOrganizationUserInput {
  email: string;
  organizationId?: string | undefined;
  passwordHash: string | null;
  principalId: string;
  type?: 'user' | 'automation';
}

async function seedOrganizationUsers(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
  await db.insert(organizations).values({
    id: 'org_456',
    name: 'Other Org',
    slug: 'other-org',
  });

  await insertOrganizationUser({
    email: 'viewer@example.com',
    passwordHash: null,
    principalId: 'prn_viewer',
  });
  await insertOrganizationUser({
    email: 'admin@example.com',
    passwordHash: 'admin-password-hash',
    principalId: 'prn_admin',
  });
  await insertOrganizationUser({
    email: 'deployer@example.com',
    passwordHash: 'deployer-password-hash',
    principalId: 'prn_deployer',
  });
  await insertOrganizationUser({
    email: 'readonly@example.com',
    passwordHash: null,
    principalId: 'prn_readonly',
  });
  await insertOrganizationUser({
    email: 'outsider@example.com',
    organizationId: 'org_456',
    passwordHash: 'outsider-password-hash',
    principalId: 'prn_outsider',
  });
}

async function insertOrganizationUser(input: InsertOrganizationUserInput): Promise<void> {
  await db.insert(principals).values({
    email: input.email,
    id: input.principalId,
    type: input.type ?? 'user',
  });
  await db.insert(organizationMemberships).values({
    id: `mem_${input.principalId}`,
    principalId: input.principalId,
    organizationId: input.organizationId ?? 'org_123',
  });
  if (input.type === 'automation') {
    return;
  }
  await db.insert(localCredentials).values({
    passwordHash: input.passwordHash,
    principalId: input.principalId,
    updatedAt: new Date('2026-04-28T10:00:00.000Z'),
  });
}

async function createSsoProvider(organizationId: string = 'org_123', providerId: string = 'sop_123'): Promise<void> {
  await db.insert(ssoOidcProviders).values({
    buttonText: 'Login with Single sign-on',
    clientId: 'client_123',
    clientSecretCiphertext: 'ciphertext',
    clientSecretEncryptionKeyId: 'key-id',
    displayName: 'Single sign-on',
    id: providerId,
    identityVerificationJson: JSON.stringify(buildDefaultSsoOidcIdentityVerificationConfig()),
    issuerUrl: 'https://idp.example.com',
    key: 'single-sign-on',
    organizationId,
    preset: 'generic',
    provisioningPolicyJson: JSON.stringify(buildDisabledSsoOidcProvisioningPolicy()),
    scope: 'openid email profile',
    updatedAt: new Date('2026-04-28T10:00:00.000Z'),
  });
}
