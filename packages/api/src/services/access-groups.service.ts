import type { CreateAccessGroupRequest, UpdateAccessGroupRequest } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import {
  createAccessGroupNameTakenError,
  createAccessGroupNotFoundError,
  createUserNotFoundError,
} from '../errors/api-business-error';
import { findOrganizationUserByEmailWithExecutor } from '../queries/organization-users.query';
import {
  addAccessGroupMembershipWithExecutor,
  createAccessGroupWithExecutor,
  deleteAccessGroupMembershipWithExecutor,
  deleteAccessGroupWithExecutor,
  findAccessGroupById,
  findAccessGroupByIdWithExecutor,
  listAccessGroupMembers,
  listAccessGroups,
  updateAccessGroupWithExecutor,
} from '../queries/rbac-groups.query';
import { deleteGroupAssignmentsWithExecutor, listAccessAssignmentSummaries } from '../queries/rbac-assignments.query';
import type {
  AccessAssignmentSummaryRow,
  AccessGroupMemberRow,
  AccessGroupRow,
  RbacTransaction,
} from '../queries/rbac.query.types';
import { normalizeDescription } from './access-description.service.helpers';
import { assertActorCanGrantGroupAssignments } from './access-groups-grantability.service';
import { buildGroupListSummaries, type GroupListSummary, toAccessGroupResult } from './access-groups.service.helpers';
import type {
  AccessGroupListRowResult,
  AccessGroupMemberMutationResult,
  AccessGroupMemberResult,
  AccessGroupResult,
  AddOrganizationAccessGroupMemberInput,
} from './access-groups.service.types';
import { runOrganizationAccessMutationTransaction } from './rbac-admin-invariant.service';

export async function listOrganizationAccessGroups(organizationId: string): Promise<AccessGroupListRowResult[]> {
  const [groups, assignments]: [AccessGroupRow[], AccessAssignmentSummaryRow[]] = await Promise.all([
    listAccessGroups(organizationId),
    listAccessAssignmentSummaries(organizationId),
  ]);
  const summariesByGroupId: ReadonlyMap<string, GroupListSummary> = await buildGroupListSummaries(assignments);
  return groups.map(
    (group: AccessGroupRow): AccessGroupListRowResult => toAccessGroupListRow(group, summariesByGroupId.get(group.id)),
  );
}

export async function readOrganizationAccessGroup(organizationId: string, groupId: string): Promise<AccessGroupResult> {
  return toAccessGroupResult(await requireAccessGroup(organizationId, groupId));
}

export async function createOrganizationAccessGroup(
  organizationId: string,
  request: CreateAccessGroupRequest,
): Promise<AccessGroupResult> {
  return await runOrganizationAccessMutationTransaction({
    organizationId,
    mutation: async (tx: RbacTransaction): Promise<AccessGroupResult> => {
      await assertAccessGroupNameAvailable(organizationId, request.name);
      const group: AccessGroupRow = await createAccessGroupWithExecutor(tx, {
        description: normalizeDescription(request.description),
        id: createId('grp'),
        name: request.name,
        organizationId,
        updatedAt: new Date(),
      });

      return toAccessGroupResult(group);
    },
  });
}

export async function updateOrganizationAccessGroup(
  organizationId: string,
  groupId: string,
  request: UpdateAccessGroupRequest,
): Promise<AccessGroupResult> {
  await requireAccessGroup(organizationId, groupId);
  await assertAccessGroupNameAvailable(organizationId, request.name, groupId);
  await runOrganizationAccessMutationTransaction({
    organizationId,
    mutation: async (tx: RbacTransaction): Promise<void> => {
      await updateAccessGroupWithExecutor(
        tx,
        organizationId,
        groupId,
        request.name,
        normalizeDescription(request.description),
        new Date(),
      );
    },
  });

  return toAccessGroupResult(await requireAccessGroup(organizationId, groupId));
}

export async function deleteOrganizationAccessGroup(organizationId: string, groupId: string): Promise<void> {
  await requireAccessGroup(organizationId, groupId);
  await runOrganizationAccessMutationTransaction({
    organizationId,
    mutation: async (tx: RbacTransaction): Promise<void> => {
      await deleteGroupAssignmentsWithExecutor(tx, organizationId, groupId);
      await deleteAccessGroupWithExecutor(tx, organizationId, groupId);
    },
  });
}

export async function addOrganizationAccessGroupMember(
  input: AddOrganizationAccessGroupMemberInput,
): Promise<AccessGroupMemberMutationResult> {
  const changed: boolean = await addAccessGroupMemberInTransaction(input);

  return {
    changed,
    members: await listOrganizationAccessGroupMembers(input.organizationId, input.groupId),
  };
}

export async function removeOrganizationAccessGroupMember(
  organizationId: string,
  groupId: string,
  email: string,
): Promise<AccessGroupMemberMutationResult> {
  let changed: boolean = false;
  await runOrganizationAccessMutationTransaction({
    organizationId,
    mutation: async (tx: RbacTransaction): Promise<void> => {
      await requireAccessGroup(organizationId, groupId);
      const principalId: string = await requireOrganizationUserPrincipalId(tx, organizationId, email);

      changed = await deleteAccessGroupMembershipWithExecutor(tx, groupId, principalId);
    },
  });

  return {
    changed,
    members: await listOrganizationAccessGroupMembers(organizationId, groupId),
  };
}

async function addAccessGroupMemberInTransaction(input: AddOrganizationAccessGroupMemberInput): Promise<boolean> {
  return await runOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    mutation: async (tx: RbacTransaction): Promise<boolean> => {
      await requireAccessGroupWithExecutor(tx, input.organizationId, input.groupId);
      await assertActorCanGrantGroupAssignments(tx, input);
      const principalId: string = await requireOrganizationUserPrincipalId(
        tx,
        input.organizationId,
        input.request.email,
      );

      return await addAccessGroupMembershipWithExecutor(tx, {
        groupId: input.groupId,
        id: createId('gmb'),
        principalId,
      });
    },
  });
}

async function requireOrganizationUserPrincipalId(
  tx: RbacTransaction,
  organizationId: string,
  email: string,
): Promise<string> {
  const user: { id: string } | undefined = await findOrganizationUserByEmailWithExecutor(tx, organizationId, email);
  if (user === undefined) {
    throw createUserNotFoundError();
  }

  return user.id;
}

export async function listOrganizationAccessGroupMembers(
  organizationId: string,
  groupId: string,
): Promise<AccessGroupMemberResult[]> {
  await requireAccessGroup(organizationId, groupId);

  return (await listAccessGroupMembers(organizationId, groupId)).map(toAccessGroupMemberResult);
}

async function requireAccessGroup(organizationId: string, groupId: string): Promise<AccessGroupRow> {
  const group: AccessGroupRow | undefined = await findAccessGroupById(organizationId, groupId);
  if (group === undefined) {
    throw createAccessGroupNotFoundError();
  }

  return group;
}

async function requireAccessGroupWithExecutor(
  tx: RbacTransaction,
  organizationId: string,
  groupId: string,
): Promise<AccessGroupRow> {
  const group: AccessGroupRow | undefined = await findAccessGroupByIdWithExecutor(tx, organizationId, groupId);
  if (group === undefined) {
    throw createAccessGroupNotFoundError();
  }

  return group;
}

async function assertAccessGroupNameAvailable(
  organizationId: string,
  groupName: string,
  groupId?: string,
): Promise<void> {
  const groups: AccessGroupRow[] = await listAccessGroups(organizationId);
  if (groups.some((group: AccessGroupRow): boolean => group.name === groupName && group.id !== groupId)) {
    throw createAccessGroupNameTakenError();
  }
}

function toAccessGroupMemberResult(member: AccessGroupMemberRow): AccessGroupMemberResult {
  return {
    email: member.email,
    id: member.id,
    status: member.status,
  };
}

function toAccessGroupListRow(group: AccessGroupRow, summary: GroupListSummary | undefined): AccessGroupListRowResult {
  return {
    ...toAccessGroupResult(group),
    assignedRoleNames: summary?.assignedRoleNames ?? [],
    assignmentScopeLabels: summary?.assignmentScopeLabels ?? [],
  };
}
