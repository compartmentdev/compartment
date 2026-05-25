import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import type { RbacTransaction } from '../src/queries/rbac.query.types';
import {
  countActiveOrganizationMembershipsForPrincipalWithExecutor,
  countOrganizationMembershipsForPrincipalWithExecutor,
  listActiveOrganizationAdminPermissionGrantRowsWithExecutor,
  listOrganizationRowsForPrincipalWithExecutor,
} from '../src/queries/organization-memberships.query';
import { organizationAdminPathPermissionKeys } from '../src/services/rbac-admin-path.service';
import {
  removeOrganizationMembershipWithExecutor,
  updateOrganizationMembershipBlockWithExecutor,
} from '../src/queries/organization-membership-mutations.query';
import type { OrganizationAdminPermissionGrantRow } from '../src/queries/organization-memberships.query.types';
import {
  organizationMemberships,
  organizations,
  principals,
  ssoOidcIdentities,
  ssoOidcProviders,
} from '../src/db/schema';
import {
  clearRbacTestHarnessRuntime,
  closeRbacTestHarness,
  configureRbacTestRuntime,
  createRbacTestHarness,
  ensureRbacTestHarness,
  resetRbacTestHarness,
  seedAssignment,
  seedGroup,
  seedGroupMembership,
  seedOrganization,
  seedOrganizationMembership,
  seedPrincipal,
  seedSystemRoles,
  findRoleIdByName,
  type RbacTestHarness,
} from './rbac-test.fixtures';

const harness: RbacTestHarness = createRbacTestHarness('organization_memberships_query');

describe('organization memberships db', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
    configureRbacTestRuntime(harness);
    await seedOrganization(harness, { id: 'org_123', slug: 'acme-dev' });
    await seedOrganization(harness, { id: 'org_456', slug: 'other-org' });
    await seedSystemRoles(harness, 'org_123');
    await seedPrincipal(harness, { email: 'direct@example.com', id: 'prn_direct', passwordHash: 'hashed' });
    await seedPrincipal(harness, { email: 'group@example.com', id: 'prn_group', passwordHash: 'hashed' });
    await seedOrganizationMembership(harness, {
      id: 'mem_direct',
      organizationId: 'org_123',
      principalId: 'prn_direct',
    });
    await seedOrganizationMembership(harness, {
      id: 'mem_group',
      organizationId: 'org_123',
      principalId: 'prn_group',
    });
  });

  afterEach((): void => {
    clearRbacTestHarnessRuntime();
  });

  afterAll(async (): Promise<void> => {
    await closeRbacTestHarness(harness);
  });

  it('creates, blocks, unblocks, and deletes memberships', async (): Promise<void> => {
    expect(await readOrganizationMembership()).toMatchObject({
      blockedAt: null,
      organizationId: 'org_123',
      principalId: 'prn_direct',
    });

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      await updateOrganizationMembershipBlockWithExecutor(tx, {
        blockedAt: new Date('2026-05-05T10:00:00.000Z'),
        organizationId: 'org_123',
        principalId: 'prn_direct',
      });
    });
    expect(
      (await harness.db.select().from(organizationMemberships).where(eq(organizationMemberships.id, 'mem_direct')))[0]
        ?.blockedAt,
    ).toBeTruthy();

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      await updateOrganizationMembershipBlockWithExecutor(tx, {
        blockedAt: null,
        organizationId: 'org_123',
        principalId: 'prn_direct',
      });
      await removeOrganizationMembershipWithExecutor(tx, {
        organizationId: 'org_123',
        principalId: 'prn_direct',
      });
    });

    expect(await readOrganizationMembership()).toBeUndefined();
  });

  it('counts active memberships and lists only unblocked organizations', async (): Promise<void> => {
    await seedOrganizationMembership(harness, {
      id: 'mem_other',
      organizationId: 'org_456',
      principalId: 'prn_direct',
    });
    await harness.db
      .update(organizationMemberships)
      .set({ blockedAt: new Date('2026-05-05T10:00:00.000Z') })
      .where(eq(organizationMemberships.id, 'mem_other'));

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      expect(await countOrganizationMembershipsForPrincipalWithExecutor(tx, 'prn_direct')).toBe(2);
      expect(await countActiveOrganizationMembershipsForPrincipalWithExecutor(tx, 'prn_direct')).toBe(1);
    });
    expect(await listOrganizationRowsForPrincipalWithExecutor(harness.db, 'prn_direct')).toEqual([
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ]);
  });

  it('counts active organization admin paths as the distinct union of direct and group-derived admins', async (): Promise<void> => {
    await seedGroup(harness, { id: 'grp_123', name: 'Admins', organizationId: 'org_123' });
    await seedGroupMembership(harness, {
      groupId: 'grp_123',
      id: 'gmb_123',
      principalId: 'prn_group',
    });
    const adminRoleId: string = await findRoleIdByName(harness, 'org_123', 'admin');
    await seedAssignment(harness, {
      id: 'asg_direct',
      organizationId: 'org_123',
      roleId: adminRoleId,
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_direct',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_group',
      organizationId: 'org_123',
      roleId: adminRoleId,
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'grp_123',
      subjectType: 'group',
    });
    await seedPrincipal(harness, { email: 'invited-admin@example.com', id: 'prn_invited_admin' });
    await seedOrganizationMembership(harness, {
      id: 'mem_invited_admin',
      organizationId: 'org_123',
      principalId: 'prn_invited_admin',
    });
    await seedAssignment(harness, {
      id: 'asg_invited_admin',
      organizationId: 'org_123',
      roleId: adminRoleId,
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_invited_admin',
      subjectType: 'principal',
    });
    await seedPrincipal(harness, {
      email: 'blocked-admin@example.com',
      id: 'prn_blocked_admin',
      passwordHash: 'hashed',
    });
    await seedOrganizationMembership(harness, {
      blockedAt: new Date('2026-05-05T10:00:00.000Z'),
      id: 'mem_blocked_admin',
      organizationId: 'org_123',
      principalId: 'prn_blocked_admin',
    });
    await seedAssignment(harness, {
      id: 'asg_blocked_admin',
      organizationId: 'org_123',
      roleId: adminRoleId,
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_blocked_admin',
      subjectType: 'principal',
    });
    await harness.db.insert(principals).values({
      email: 'automation-admin@example.com',
      id: 'prn_automation_admin',
      type: 'automation',
    });
    await seedOrganizationMembership(harness, {
      id: 'mem_automation_admin',
      organizationId: 'org_123',
      principalId: 'prn_automation_admin',
    });
    await seedAssignment(harness, {
      id: 'asg_automation_admin',
      organizationId: 'org_123',
      roleId: adminRoleId,
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_automation_admin',
      subjectType: 'principal',
    });

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      const rows: OrganizationAdminPermissionGrantRow[] =
        await listActiveOrganizationAdminPermissionGrantRowsWithExecutor(
          tx,
          'org_123',
          organizationAdminPathPermissionKeys,
        );
      const principalIds: string[] = [
        ...new Set(rows.map((row: OrganizationAdminPermissionGrantRow): string => row.principalId)),
      ].sort((left: string, right: string): number => left.localeCompare(right));
      expect(principalIds).toEqual(['prn_direct', 'prn_group']);
    });
  });

  it('counts SSO-only admins but not password-only admins when local passwords are disabled', async (): Promise<void> => {
    await harness.db.update(organizations).set({ localPasswordEnabled: false }).where(eq(organizations.id, 'org_123'));
    await seedPrincipal(harness, { email: 'sso-admin@example.com', id: 'prn_sso_admin', passwordHash: null });
    await seedOrganizationMembership(harness, {
      id: 'mem_sso_admin',
      organizationId: 'org_123',
      principalId: 'prn_sso_admin',
    });
    await seedSsoProvider();
    await harness.db.insert(ssoOidcIdentities).values({
      id: 'soi_admin',
      principalId: 'prn_sso_admin',
      providerId: 'sop_123',
      subject: 'sso-admin-subject',
    });
    const adminRoleId: string = await findRoleIdByName(harness, 'org_123', 'admin');
    await seedAssignment(harness, {
      id: 'asg_password_only_admin',
      organizationId: 'org_123',
      roleId: adminRoleId,
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_direct',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_sso_admin',
      organizationId: 'org_123',
      roleId: adminRoleId,
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_sso_admin',
      subjectType: 'principal',
    });

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      const rows: OrganizationAdminPermissionGrantRow[] =
        await listActiveOrganizationAdminPermissionGrantRowsWithExecutor(
          tx,
          'org_123',
          organizationAdminPathPermissionKeys,
        );
      const principalIds: string[] = [
        ...new Set(rows.map((row: OrganizationAdminPermissionGrantRow): string => row.principalId)),
      ].sort((left: string, right: string): number => left.localeCompare(right));
      expect(principalIds).toEqual(['prn_sso_admin']);
    });
  });
});

async function seedSsoProvider(): Promise<void> {
  await harness.db.insert(ssoOidcProviders).values({
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
    provisioningPolicyJson: JSON.stringify(buildDisabledSsoOidcProvisioningPolicy()),
    scope: 'openid email profile',
    updatedAt: new Date('2026-05-05T10:00:00.000Z'),
  });
}

async function readOrganizationMembership(): Promise<
  { blockedAt: Date | null; organizationId: string; principalId: string } | undefined
> {
  const rows: (typeof organizationMemberships.$inferSelect)[] = await harness.db
    .select()
    .from(organizationMemberships)
    .where(eq(organizationMemberships.id, 'mem_direct'))
    .limit(1);
  const row: typeof organizationMemberships.$inferSelect | undefined = rows[0];
  if (row === undefined) {
    return undefined;
  }

  return {
    blockedAt: row.blockedAt,
    organizationId: row.organizationId,
    principalId: row.principalId,
  };
}
