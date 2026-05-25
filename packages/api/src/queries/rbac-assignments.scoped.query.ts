import { and, eq, isNull } from 'drizzle-orm';
import { accessAssignments, accessGroupMemberships, accessGroups, organizationMemberships } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  buildGroupPrincipalMembershipJoin,
  buildGroupSubjectAssignmentJoin,
} from './rbac-assignments.grants.query.helpers';
import type { ScopedAssignmentIdsInput } from './rbac.query.types';

export async function listEnvironmentScopedAssignmentEnvironmentIds(
  organizationId: string,
  principalId: string,
): Promise<string[]> {
  return await listScopedAssignmentIds({ organizationId, principalId, scopeType: 'environment' });
}

async function listScopedAssignmentIds(input: ScopedAssignmentIdsInput): Promise<string[]> {
  const directIds: string[] = await listScopedDirectAssignmentIds(input);
  const groupIds: string[] = await listScopedGroupAssignmentIds(input);
  return [...new Set([...directIds, ...groupIds])];
}

async function listScopedDirectAssignmentIds(input: ScopedAssignmentIdsInput): Promise<string[]> {
  const rows: { scopeId: string }[] = await getApiDatabase()
    .select({ scopeId: accessAssignments.scopeId })
    .from(accessAssignments)
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, accessAssignments.organizationId),
        eq(organizationMemberships.principalId, accessAssignments.subjectId),
      ),
    )
    .where(
      and(
        eq(accessAssignments.organizationId, input.organizationId),
        eq(accessAssignments.subjectType, 'principal'),
        eq(accessAssignments.subjectId, input.principalId),
        eq(accessAssignments.scopeType, input.scopeType),
        isNull(organizationMemberships.blockedAt),
      ),
    );
  return rows.map((row: { scopeId: string }): string => row.scopeId);
}

async function listScopedGroupAssignmentIds(input: ScopedAssignmentIdsInput): Promise<string[]> {
  const rows: { scopeId: string }[] = await getApiDatabase()
    .select({ scopeId: accessAssignments.scopeId })
    .from(accessGroupMemberships)
    .innerJoin(accessGroups, eq(accessGroups.id, accessGroupMemberships.groupId))
    .innerJoin(organizationMemberships, buildGroupPrincipalMembershipJoin())
    .innerJoin(accessAssignments, buildGroupSubjectAssignmentJoin())
    .where(
      and(
        eq(accessGroups.organizationId, input.organizationId),
        eq(accessGroupMemberships.principalId, input.principalId),
        eq(accessAssignments.scopeType, input.scopeType),
        isNull(organizationMemberships.blockedAt),
      ),
    );
  return rows.map((row: { scopeId: string }): string => row.scopeId);
}
