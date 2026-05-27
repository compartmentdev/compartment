import type { UpdateAccessRoleRequest } from '@compartment/contracts';
import { createAccessRoleNameTakenError } from '../errors/api-business-error';
import { findAccessRoleByNameWithExecutor, listAccessRolesPage } from '../queries/rbac-roles.query';
import type { AccessAssignmentSummaryRow, AccessRoleRow, RbacTransaction } from '../queries/rbac.query.types';
import { normalizeDescription } from './access-description.service.helpers';
import type {
  AccessRoleListRowResult,
  ListOrganizationAccessRolesPageInput,
  OrganizationAccessRolesPageResult,
} from './access-roles.service.types';

interface RoleUsageAccumulator {
  assignmentCount: number;
  groupIds: Set<string>;
  principalEmails: Set<string>;
}

export interface RoleUsageSummary {
  assignmentCount: number;
  groupCount: number;
  principalCount: number;
}

export function buildRoleUsageByRoleId(
  assignments: readonly AccessAssignmentSummaryRow[],
): ReadonlyMap<string, RoleUsageSummary> {
  const usageByRoleId: Map<string, RoleUsageAccumulator> = new Map<string, RoleUsageAccumulator>();
  for (const assignment of assignments) {
    addRoleUsageAssignment(usageByRoleId, assignment);
  }

  return toRoleUsageSummaryMap(usageByRoleId);
}

function addRoleUsageAssignment(
  usageByRoleId: Map<string, RoleUsageAccumulator>,
  assignment: AccessAssignmentSummaryRow,
): void {
  const usage: RoleUsageAccumulator = usageByRoleId.get(assignment.roleId) ?? createRoleUsageAccumulator();
  usage.assignmentCount += 1;
  if (assignment.subjectType === 'group') {
    usage.groupIds.add(assignment.groupId);
  } else {
    usage.principalEmails.add(assignment.principalEmail);
  }
  usageByRoleId.set(assignment.roleId, usage);
}

function toRoleUsageSummaryMap(
  usageByRoleId: Map<string, RoleUsageAccumulator>,
): ReadonlyMap<string, RoleUsageSummary> {
  return new Map<string, RoleUsageSummary>(
    [...usageByRoleId.entries()].map(([roleId, usage]: [string, RoleUsageAccumulator]): [string, RoleUsageSummary] => [
      roleId,
      {
        assignmentCount: usage.assignmentCount,
        groupCount: usage.groupIds.size,
        principalCount: usage.principalEmails.size,
      },
    ]),
  );
}

function createRoleUsageAccumulator(): RoleUsageAccumulator {
  return {
    assignmentCount: 0,
    groupIds: new Set<string>(),
    principalEmails: new Set<string>(),
  };
}

export function toAccessRoleListRowResult(role: AccessRoleListRowResult): AccessRoleListRowResult {
  return {
    assignmentCount: role.assignmentCount,
    description: role.description,
    groupCount: role.groupCount,
    id: role.id,
    kind: role.kind,
    name: role.name,
    permissionKeys: role.permissionKeys,
    principalCount: role.principalCount,
  };
}

export function readNextAccessRole(role: AccessRoleRow, request: UpdateAccessRoleRequest): AccessRoleRow {
  return {
    ...role,
    description: request.description === undefined ? role.description : normalizeDescription(request.description),
    name: request.name ?? role.name,
    permissionKeys: request.permissionKeys ?? role.permissionKeys,
  };
}

export async function readOrganizationAccessRolesPage(
  input: ListOrganizationAccessRolesPageInput,
): Promise<OrganizationAccessRolesPageResult> {
  return await listAccessRolesPage({
    organizationId: input.organizationId,
    orderBy: input.orderBy ?? 'name',
    page: input.page ?? 1,
    perPage: input.perPage ?? 100,
    search: input.search,
    sort: input.sort ?? 'asc',
  });
}

export async function assertAccessRoleNameAvailable(
  tx: RbacTransaction,
  organizationId: string,
  roleName: string,
  roleId?: string,
): Promise<void> {
  const existingRole: AccessRoleRow | undefined = await findAccessRoleByNameWithExecutor(tx, organizationId, roleName);
  if (existingRole !== undefined && existingRole.id !== roleId) {
    throw createAccessRoleNameTakenError();
  }
}
