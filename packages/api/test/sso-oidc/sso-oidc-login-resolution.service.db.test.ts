import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
  type CompartmentMembershipRole,
  type SsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../../test-support/src';
import type { ApiConfig } from '../../src/config';
import { createDatabase, createDatabasePool, type Database } from '../../src/db/client';
import {
  accessAssignments,
  accessRoles,
  authSessions,
  organizationMemberships,
  operations,
  organizations,
  principals,
  ssoOidcIdentities,
} from '../../src/db/schema';
import { parseVariablesMasterKey } from '../../src/lib/variables-crypto';
import { createSsoOidcProvider } from '../../src/queries/sso-oidc.query';
import type { RbacTransaction } from '../../src/queries/rbac.query.types';
import type { CreateSsoOidcProviderInput, SsoOidcProviderRow } from '../../src/queries/sso-oidc.query.types';
import { resolveSsoOidcLoginSession } from '../../src/services/sso-oidc/sso-oidc-login-resolution.service';
import type { ResolveSsoOidcLoginSessionResult } from '../../src/services/sso-oidc/sso-oidc-login-resolution.service.types';
import type { OidcIdentityClaims } from '../../src/services/sso-oidc/sso-oidc-client.adapter.types';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from '../../src/services/rbac-seed.service';
import { useApiRuntimeDatabaseTestHarness } from '../api-db-test.harness';
import { defaultApiAuthThrottleConfig } from '../auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from '../audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const ssoOidcLoginResolutionDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'sso_oidc_login_resolution_service',
);
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  controlPlaneHost: 'compartment.localhost',
  customTlsDirectory: '/etc/compartment/tls',
  databaseUrl: ssoOidcLoginResolutionDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
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
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(ssoOidcLoginResolutionDatabaseUrl);
const db: Database = createDatabase(pool);

interface AuthSessionPrincipalRow {
  principalId: string;
}

interface MembershipPrincipalRow {
  organizationId: string;
  principalId: string;
}

interface OidcIdentityProviderRow {
  providerId: string;
}

interface OperationTypeRow {
  type: string;
}

describe('SSO OIDC login resolution service', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: ssoOidcLoginResolutionDatabaseUrl,
    db,
    pool,
    setup: createOrganization,
  });

  it('rejects unknown users when provider auto-join is disabled', async (): Promise<void> => {
    const provider: SsoOidcProviderRow = await createProvider(buildDisabledSsoOidcProvisioningPolicy());

    await expect(
      resolveSsoOidcLoginSession({
        claims: createClaims('admin@example.com'),
        provider,
      }),
    ).rejects.toThrow('The SSO login could not be completed.');
    await expect(db.select().from(principals)).resolves.toHaveLength(0);
    await expect(db.select().from(authSessions)).resolves.toHaveLength(0);
    await expect(db.select().from(operations)).resolves.toHaveLength(0);
  });

  it('rejects unknown users whose verified email domain is not allowed', async (): Promise<void> => {
    const provider: SsoOidcProviderRow = await createProvider({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });

    await expect(
      resolveSsoOidcLoginSession({
        claims: createClaims('admin@other.example'),
        provider,
      }),
    ).rejects.toThrow('The SSO login could not be completed.');
    await expect(db.select().from(organizationMemberships)).resolves.toHaveLength(0);
    await expect(db.select().from(ssoOidcIdentities)).resolves.toHaveLength(0);
  });

  it('auto-joins verified users with allowed domains and records audit entries', async (): Promise<void> => {
    const provider: SsoOidcProviderRow = await createProvider({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'readonly',
    });

    const result: ResolveSsoOidcLoginSessionResult = await resolveSsoOidcLoginSession({
      claims: createClaims('admin@example.com'),
      provider,
    });

    expect(result.principal).toEqual({
      principalEmail: 'admin@example.com',
      principalId: result.principal.principalId,
      principalType: 'user',
    });
    expect(result.session.authMethodKind).toBe('oidc');
    expect(result.session.oidcProviderId).toBe(provider.id);
    expect(result.session.organizationId).toBe('org_123');

    const membershipRows: MembershipPrincipalRow[] = await db
      .select({
        organizationId: organizationMemberships.organizationId,
        principalId: organizationMemberships.principalId,
      })
      .from(organizationMemberships);
    const sessionRows: AuthSessionPrincipalRow[] = await db
      .select({ principalId: authSessions.principalId })
      .from(authSessions);
    const identityRows: OidcIdentityProviderRow[] = await db
      .select({ providerId: ssoOidcIdentities.providerId })
      .from(ssoOidcIdentities);
    const operationRows: OperationTypeRow[] = await db.select({ type: operations.type }).from(operations);
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0]?.organizationId).toBe('org_123');
    expect(membershipRows[0]?.principalId).toBe(result.principal.principalId);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.principalId).toBe(result.principal.principalId);
    expect(identityRows).toHaveLength(1);
    expect(identityRows[0]?.providerId).toBe(provider.id);
    await expect(readAssignedRoleNames(result.principal.principalId)).resolves.toContain('readonly');
    expect(operationRows.map((row: OperationTypeRow): string => row.type).sort(compareTypes)).toEqual([
      'auth.sso_oidc.auto_join',
      'auth.sso_oidc.login',
    ]);
  });

  it('auto-joins verified users when local passwords are disabled for the organization', async (): Promise<void> => {
    await db.update(organizations).set({ localPasswordEnabled: false }).where(eq(organizations.id, 'org_123'));
    const provider: SsoOidcProviderRow = await createProvider({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });

    const result: ResolveSsoOidcLoginSessionResult = await resolveSsoOidcLoginSession({
      claims: createClaims('admin@example.com'),
      provider,
    });

    expect(result.session.authMethodKind).toBe('oidc');
    expect(result.session.organizationId).toBe('org_123');
    await expect(readAssignedRoleNames(result.principal.principalId)).resolves.toContain('viewer');
  });

  it('links invited organization members without recording auto-join', async (): Promise<void> => {
    const provider: SsoOidcProviderRow = await createProvider({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });
    await createInvitedOrganizationMember('invitee@example.com', 'prn_existing', 'viewer');

    const result: ResolveSsoOidcLoginSessionResult = await resolveSsoOidcLoginSession({
      claims: createClaims('invitee@example.com'),
      provider,
    });

    const membershipRows: MembershipPrincipalRow[] = await db
      .select({
        organizationId: organizationMemberships.organizationId,
        principalId: organizationMemberships.principalId,
      })
      .from(organizationMemberships);
    const operationRows: OperationTypeRow[] = await db.select({ type: operations.type }).from(operations);
    expect(result.principal.principalId).toBe('prn_existing');
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0]).toEqual({ organizationId: 'org_123', principalId: 'prn_existing' });
    expect(operationRows).toEqual([{ type: 'auth.sso_oidc.login' }]);
  });

  it('rejects auto-join for blocked organization members', async (): Promise<void> => {
    const provider: SsoOidcProviderRow = await createProvider({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });
    await createInvitedOrganizationMember('blocked@example.com', 'prn_blocked', 'viewer', {
      blockedAt: new Date('2026-04-30T10:00:00.000Z'),
    });

    await expect(
      resolveSsoOidcLoginSession({
        claims: createClaims('blocked@example.com'),
        provider,
      }),
    ).rejects.toThrow('The SSO login could not be completed.');
    await expect(db.select().from(authSessions)).resolves.toHaveLength(0);
    await expect(db.select().from(operations)).resolves.toHaveLength(0);
  });

  it('recreates membership for removed users who already have an SSO identity', async (): Promise<void> => {
    const provider: SsoOidcProviderRow = await createProvider({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });
    await createInvitedOrganizationMember('returning@example.com', 'prn_returning', 'readonly');
    await db.insert(ssoOidcIdentities).values({
      id: 'soi_existing',
      lastLoginAt: new Date('2026-04-21T10:00:00.000Z'),
      principalId: 'prn_returning',
      providerId: provider.id,
      subject: 'subject_123',
    });
    await db.delete(organizationMemberships).where(eq(organizationMemberships.principalId, 'prn_returning'));

    const result: ResolveSsoOidcLoginSessionResult = await resolveSsoOidcLoginSession({
      claims: createClaims('returning@example.com'),
      provider,
    });

    const membershipRows: MembershipPrincipalRow[] = await db
      .select({
        organizationId: organizationMemberships.organizationId,
        principalId: organizationMemberships.principalId,
      })
      .from(organizationMemberships);
    const identityRows: OidcIdentityProviderRow[] = await db
      .select({ providerId: ssoOidcIdentities.providerId })
      .from(ssoOidcIdentities);
    const operationRows: OperationTypeRow[] = await db.select({ type: operations.type }).from(operations);
    expect(result.principal.principalId).toBe('prn_returning');
    expect(membershipRows).toEqual([{ organizationId: 'org_123', principalId: 'prn_returning' }]);
    expect(identityRows).toHaveLength(1);
    await expect(readAssignedRoleNames('prn_returning')).resolves.toContain('viewer');
    expect(operationRows.map((row: OperationTypeRow): string => row.type).sort(compareTypes)).toEqual([
      'auth.sso_oidc.auto_join',
      'auth.sso_oidc.login',
    ]);
  });

  it('auto-joins the same email after the old SSO identity link is removed', async (): Promise<void> => {
    const provider: SsoOidcProviderRow = await createProvider({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });
    await createInvitedOrganizationMember('removed@example.com', 'prn_removed', 'readonly');
    await db.insert(ssoOidcIdentities).values({
      id: 'soi_removed',
      lastLoginAt: new Date('2026-04-21T10:00:00.000Z'),
      principalId: 'prn_removed',
      providerId: provider.id,
      subject: 'subject_123',
    });
    await db.delete(ssoOidcIdentities).where(eq(ssoOidcIdentities.principalId, 'prn_removed'));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.principalId, 'prn_removed'));

    const result: ResolveSsoOidcLoginSessionResult = await resolveSsoOidcLoginSession({
      claims: createClaims('removed@example.com'),
      provider,
    });

    const membershipRows: MembershipPrincipalRow[] = await db
      .select({
        organizationId: organizationMemberships.organizationId,
        principalId: organizationMemberships.principalId,
      })
      .from(organizationMemberships);
    const identityRows: { principalId: string; providerId: string }[] = await db
      .select({ principalId: ssoOidcIdentities.principalId, providerId: ssoOidcIdentities.providerId })
      .from(ssoOidcIdentities);
    const operationRows: OperationTypeRow[] = await db.select({ type: operations.type }).from(operations);
    expect(result.principal.principalEmail).toBe('removed@example.com');
    expect(result.principal.principalId).toBe('prn_removed');
    expect(membershipRows).toEqual([{ organizationId: 'org_123', principalId: result.principal.principalId }]);
    expect(identityRows).toEqual([{ principalId: result.principal.principalId, providerId: provider.id }]);
    await expect(readAssignedRoleNames(result.principal.principalId)).resolves.toContain('viewer');
    expect(operationRows.map((row: OperationTypeRow): string => row.type).sort(compareTypes)).toEqual([
      'auth.sso_oidc.auto_join',
      'auth.sso_oidc.login',
    ]);
  });
});

interface CreateInvitedOrganizationMemberOptions {
  blockedAt?: Date | null | undefined;
}

async function createOrganization(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
}

async function createInvitedOrganizationMember(
  email: string,
  principalId: string,
  role: CompartmentMembershipRole,
  options: CreateInvitedOrganizationMemberOptions = {},
): Promise<void> {
  await db.insert(principals).values({
    email,
    id: principalId,
    type: 'user',
  });
  await db.insert(organizationMemberships).values({
    blockedAt: options.blockedAt,
    id: `mem_${principalId}`,
    organizationId: 'org_123',
    principalId,
  });
  await db.transaction(async (transaction: RbacTransaction): Promise<void> => {
    await assignOrganizationSystemRoleToPrincipalWithExecutor(transaction, 'org_123', principalId, role);
  });
}

async function createProvider(provisioning: SsoOidcProvisioningPolicy): Promise<SsoOidcProviderRow> {
  return await createSsoOidcProvider(createProviderInput(provisioning));
}

function compareTypes(left: string, right: string): number {
  return left.localeCompare(right);
}

async function readAssignedRoleNames(principalId: string): Promise<string[]> {
  const rows: { name: string }[] = await db
    .select({ name: accessRoles.name })
    .from(accessAssignments)
    .innerJoin(accessRoles, eq(accessRoles.id, accessAssignments.roleId))
    .where(eq(accessAssignments.subjectId, principalId));

  return rows.map((row: { name: string }): string => row.name);
}

function createProviderInput(provisioning: SsoOidcProvisioningPolicy): CreateSsoOidcProviderInput {
  return {
    buttonText: 'Login with Single sign-on',
    clientId: 'client_123',
    clientSecretCiphertext: 'ciphertext',
    clientSecretEncryptionKeyId: 'key-id',
    displayName: 'Single sign-on',
    id: 'sop_123',
    identityVerificationJson: JSON.stringify(buildDefaultSsoOidcIdentityVerificationConfig()),
    issuerUrl: 'https://idp.example.com',
    key: 'single-sign-on',
    organizationId: 'org_123',
    preset: 'generic',
    provisioningPolicyJson: JSON.stringify(provisioning),
    scope: 'openid email profile',
    updatedAt: new Date('2026-04-21T10:00:00.000Z'),
  };
}

function createClaims(email: string): OidcIdentityClaims {
  return {
    email,
    emailVerified: true,
    issuer: 'https://idp.example.com',
    subject: 'subject_123',
  };
}
