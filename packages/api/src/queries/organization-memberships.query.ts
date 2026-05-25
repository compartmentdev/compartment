import type { PermissionKey } from '@compartment/contracts';
import { and, count, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { Database } from '../db/client';
import {
  accessAssignments,
  accessGroupMemberships,
  accessGroups,
  accessRolePermissions,
  localCredentials,
  organizationMemberships,
  organizations,
  principals,
} from '../db/schema';
import { buildPrincipalHasSsoOidcIdentityExpression } from './organization-users.query.helpers';
import type {
  OrganizationAdminPermissionGrantRow,
  OrganizationMembershipOrganizationRow,
} from './organization-memberships.query.types';
import type { CreateOrganizationMembershipInput, RbacTransaction } from './rbac.query.types';

type OrganizationAdminPermissionGrantSelection = SelectedFields & {
  permissionKey: typeof accessRolePermissions.permissionKey;
  principalId: typeof organizationMemberships.principalId;
};

const organizationAdminPermissionGrantSelection: OrganizationAdminPermissionGrantSelection = {
  permissionKey: accessRolePermissions.permissionKey,
  principalId: organizationMemberships.principalId,
};

export async function createOrganizationMembershipWithExecutor(
  executor: RbacTransaction,
  input: CreateOrganizationMembershipInput,
): Promise<void> {
  await executor.insert(organizationMemberships).values({
    id: input.id,
    organizationId: input.organizationId,
    principalId: input.principalId,
  });
}

export async function countOrganizationMembershipsForPrincipalWithExecutor(
  executor: RbacTransaction,
  principalId: string,
): Promise<number> {
  const rows: { value: number }[] = await executor
    .select({ value: count() })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.principalId, principalId));

  return rows[0]?.value ?? 0;
}

export async function countActiveOrganizationMembershipsForPrincipalWithExecutor(
  executor: OrganizationMembershipCounter,
  principalId: string,
): Promise<number> {
  const rows: { value: number }[] = await executor
    .select({ value: count() })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.principalId, principalId), isNull(organizationMemberships.blockedAt)));

  return rows[0]?.value ?? 0;
}

export async function hasLocalPasswordEnabledOrganizationMembershipByIdWithExecutor(
  executor: OrganizationMembershipReader,
  principalId: string,
  organizationId: string,
): Promise<boolean> {
  const rows: { organizationId: string }[] = await executor
    .select({
      organizationId: organizationMemberships.organizationId,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(
      and(
        eq(organizationMemberships.principalId, principalId),
        eq(organizationMemberships.organizationId, organizationId),
        isNull(organizationMemberships.blockedAt),
        eq(organizations.localPasswordEnabled, true),
      ),
    )
    .limit(1);

  return rows.length === 1;
}

export async function listActiveOrganizationAdminPermissionGrantRowsWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  requiredPermissionKeys: readonly PermissionKey[],
): Promise<OrganizationAdminPermissionGrantRow[]> {
  const directRows: OrganizationAdminPermissionGrantRow[] = await listDirectOrganizationAdminPermissionGrantRows(
    executor,
    organizationId,
    requiredPermissionKeys,
  );
  const groupRows: OrganizationAdminPermissionGrantRow[] = await listGroupOrganizationAdminPermissionGrantRows(
    executor,
    organizationId,
    requiredPermissionKeys,
  );

  return [...directRows, ...groupRows];
}

export async function listOrganizationRowsForPrincipalWithExecutor(
  executor: OrganizationMembershipReader,
  principalId: string,
): Promise<OrganizationMembershipOrganizationRow[]> {
  return await readOrganizationRowsForPrincipal(executor, principalId);
}

export async function findOrganizationRowForPrincipalBySlugWithExecutor(
  executor: OrganizationMembershipReader,
  principalId: string,
  organizationSlug: string,
): Promise<OrganizationMembershipOrganizationRow | undefined> {
  const rows: OrganizationMembershipOrganizationRow[] = await readOrganizationRowsForPrincipal(
    executor,
    principalId,
    organizationSlug,
  );

  return rows[0];
}

export async function findOrganizationRowForPrincipalByIdWithExecutor(
  executor: OrganizationMembershipReader,
  principalId: string,
  organizationId: string,
): Promise<OrganizationMembershipOrganizationRow | undefined> {
  const rows: OrganizationMembershipOrganizationRow[] = await executor
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(
      and(
        eq(organizationMemberships.principalId, principalId),
        eq(organizationMemberships.organizationId, organizationId),
        isNull(organizationMemberships.blockedAt),
      ),
    )
    .limit(1);

  return rows[0];
}

async function readOrganizationRowsForPrincipal(
  executor: OrganizationMembershipReader,
  principalId: string,
  organizationSlug: string | null = null,
): Promise<OrganizationMembershipOrganizationRow[]> {
  return await executor
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(buildPrincipalOrganizationFilter(principalId, organizationSlug));
}

type OrganizationMembershipReader = Database | RbacTransaction;
type OrganizationMembershipCounter = Database | RbacTransaction;

async function listDirectOrganizationAdminPermissionGrantRows(
  executor: RbacTransaction,
  organizationId: string,
  requiredPermissionKeys: readonly PermissionKey[],
): Promise<OrganizationAdminPermissionGrantRow[]> {
  if (requiredPermissionKeys.length === 0) {
    return [];
  }

  return (await executor
    .select(organizationAdminPermissionGrantSelection)
    .from(accessAssignments)
    .innerJoin(organizationMemberships, buildDirectAdminMembershipJoin())
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
    .leftJoin(localCredentials, eq(localCredentials.principalId, organizationMemberships.principalId))
    .innerJoin(accessRolePermissions, eq(accessRolePermissions.roleId, accessAssignments.roleId))
    .where(
      and(
        buildOrganizationAdminPermissionFilter(organizationId, requiredPermissionKeys),
        buildDirectAdminAssignmentFilter(),
      ),
    )) as OrganizationAdminPermissionGrantRow[];
}

async function listGroupOrganizationAdminPermissionGrantRows(
  executor: RbacTransaction,
  organizationId: string,
  requiredPermissionKeys: readonly PermissionKey[],
): Promise<OrganizationAdminPermissionGrantRow[]> {
  if (requiredPermissionKeys.length === 0) {
    return [];
  }

  return (await executor
    .select(organizationAdminPermissionGrantSelection)
    .from(accessGroupMemberships)
    .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMemberships.groupId))
    .innerJoin(organizationMemberships, buildGroupAdminOrganizationMembershipJoin())
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .innerJoin(principals, eq(principals.id, organizationMemberships.principalId))
    .leftJoin(localCredentials, eq(localCredentials.principalId, organizationMemberships.principalId))
    .innerJoin(accessAssignments, buildGroupAdminAssignmentJoin())
    .innerJoin(accessRolePermissions, eq(accessRolePermissions.roleId, accessAssignments.roleId))
    .where(
      buildOrganizationAdminPermissionFilter(organizationId, requiredPermissionKeys),
    )) as OrganizationAdminPermissionGrantRow[];
}

function buildOrganizationAdminPermissionFilter(
  organizationId: string,
  requiredPermissionKeys: readonly PermissionKey[],
): SQL {
  return and(
    eq(organizationMemberships.organizationId, organizationId),
    isNull(organizationMemberships.blockedAt),
    eq(principals.type, 'user'),
    or(
      and(eq(organizations.localPasswordEnabled, true), isNotNull(localCredentials.passwordHash)),
      buildPrincipalHasSsoOidcIdentityExpression(principals.id, organizationId),
    ),
    inArray(accessRolePermissions.permissionKey, [...requiredPermissionKeys]),
  )!;
}

function buildPrincipalOrganizationFilter(principalId: string, organizationSlug: string | null): SQL {
  return and(
    eq(organizationMemberships.principalId, principalId),
    organizationSlug === null ? undefined : eq(organizations.slug, organizationSlug),
    isNull(organizationMemberships.blockedAt),
  )!;
}

function buildGroupAdminOrganizationMembershipJoin(): SQL {
  return and(
    eq(accessGroups.organizationId, organizationMemberships.organizationId),
    eq(organizationMemberships.principalId, accessGroupMemberships.principalId),
  )!;
}

function buildDirectAdminMembershipJoin(): SQL {
  return and(
    eq(accessAssignments.subjectId, organizationMemberships.principalId),
    eq(accessAssignments.organizationId, organizationMemberships.organizationId),
  )!;
}

function buildGroupAdminAssignmentJoin(): SQL {
  return and(
    eq(accessAssignments.organizationId, organizationMemberships.organizationId),
    eq(accessAssignments.subjectType, 'group'),
    eq(accessAssignments.subjectId, accessGroups.id),
    eq(accessAssignments.scopeType, 'organization'),
    eq(accessAssignments.scopeId, organizationMemberships.organizationId),
  )!;
}

function buildDirectAdminAssignmentFilter(): SQL {
  return and(
    eq(accessAssignments.subjectType, 'principal'),
    eq(accessAssignments.scopeType, 'organization'),
    eq(accessAssignments.scopeId, organizationMemberships.organizationId),
  )!;
}
