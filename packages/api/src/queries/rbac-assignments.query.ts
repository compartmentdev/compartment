import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { accessAssignments, accessGroups, accessRoles, organizationMemberships, principals } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AccessAssignmentRow,
  AccessAssignmentSummaryRow,
  AccessAssignmentSummarySelection,
  CreateAccessAssignmentInput,
  CreateAccessAssignmentResult,
  PrincipalScopeRow,
  RbacTransaction,
} from './rbac.query.types';
import { buildDirectPrincipalMembershipJoin } from './rbac-assignments.grants.query.helpers';
import { toAccessAssignmentRow } from './rbac-assignments.query.helpers';

export {
  listAllPrincipalPermissionGrantStates,
  listDirectPrincipalPermissionKeys,
  listDirectPrincipalPermissionGrantRows,
  listDirectPrincipalPermissionGrantRowsWithExecutor,
  listPrincipalGrantedRoleNames,
  listGroupPrincipalPermissionKeys,
  listGroupPrincipalPermissionGrantRows,
  listGroupPrincipalPermissionGrantRowsWithExecutor,
} from './rbac-assignments.grants.query';
export { listGroupAccessAssignmentPermissionGrantRowsWithExecutor } from './rbac-assignments.group.query';
export { listEnvironmentScopedAssignmentEnvironmentIds } from './rbac-assignments.scoped.query';
export async function createAccessAssignmentWithExecutor(
  executor: RbacTransaction,
  input: CreateAccessAssignmentInput,
): Promise<CreateAccessAssignmentResult> {
  const rows: (typeof accessAssignments.$inferSelect)[] = await executor
    .insert(accessAssignments)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      roleId: input.roleId,
      scopeId: input.scopeId,
      scopeType: input.scopeType,
      subjectId: input.subjectId,
      subjectType: input.subjectType,
    })
    .onConflictDoNothing()
    .returning();

  return rows[0] === undefined
    ? { assignment: await findAccessAssignmentByUniqueWithExecutor(executor, input), created: false }
    : { assignment: toAccessAssignmentRow(rows[0]), created: true };
}
export async function deleteAccessAssignmentWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  assignmentId: string,
): Promise<void> {
  await executor
    .delete(accessAssignments)
    .where(and(eq(accessAssignments.organizationId, organizationId), eq(accessAssignments.id, assignmentId)));
}
export async function findAccessAssignmentByIdWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  assignmentId: string,
): Promise<AccessAssignmentRow | undefined> {
  const rows: (typeof accessAssignments.$inferSelect)[] = await executor
    .select()
    .from(accessAssignments)
    .where(and(eq(accessAssignments.organizationId, organizationId), eq(accessAssignments.id, assignmentId)))
    .limit(1);

  const assignment: typeof accessAssignments.$inferSelect | undefined = rows[0];
  return assignment === undefined ? undefined : toAccessAssignmentRow(assignment);
}
export async function deletePrincipalAssignmentsWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  principalId: string,
): Promise<void> {
  await executor
    .delete(accessAssignments)
    .where(
      and(
        eq(accessAssignments.organizationId, organizationId),
        eq(accessAssignments.subjectType, 'principal'),
        eq(accessAssignments.subjectId, principalId),
      ),
    );
}
export async function deleteGroupAssignmentsWithExecutor(
  executor: RbacTransaction,
  organizationId: string,
  groupId: string,
): Promise<void> {
  await executor
    .delete(accessAssignments)
    .where(
      and(
        eq(accessAssignments.organizationId, organizationId),
        eq(accessAssignments.subjectType, 'group'),
        eq(accessAssignments.subjectId, groupId),
      ),
    );
}
export async function listAccessAssignmentSummaries(organizationId: string): Promise<AccessAssignmentSummaryRow[]> {
  return await readAllAccessAssignmentSummaryRows(organizationId);
}
export async function listDirectAccessAssignmentSummariesForPrincipal(
  organizationId: string,
  principalId: string,
): Promise<AccessAssignmentSummaryRow[]> {
  return await readPrincipalAccessAssignmentSummaryRows(organizationId, principalId);
}
export async function listDirectAssignmentScopesForPrincipals(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalScopeRow[]> {
  if (principalIds.length === 0) {
    return [];
  }

  return await readDirectAssignmentScopeQueryRows(organizationId, principalIds);
}
async function readDirectAssignmentScopeQueryRows(
  organizationId: string,
  principalIds: readonly string[],
): Promise<PrincipalScopeRow[]> {
  return (await getApiDatabase()
    .select({
      principalId: accessAssignments.subjectId,
      scopeId: accessAssignments.scopeId,
      scopeType: accessAssignments.scopeType,
    })
    .from(accessAssignments)
    .innerJoin(organizationMemberships, buildDirectPrincipalMembershipJoin())
    .where(
      and(
        eq(accessAssignments.organizationId, organizationId),
        eq(accessAssignments.subjectType, 'principal'),
        inArray(accessAssignments.subjectId, [...principalIds]),
        isNull(organizationMemberships.blockedAt),
      ),
    )) as PrincipalScopeRow[];
}
async function readAllAccessAssignmentSummaryRows(organizationId: string): Promise<AccessAssignmentSummaryRow[]> {
  return await readAccessAssignmentSummaryQueryRows(
    and(eq(accessAssignments.organizationId, organizationId), buildPresentAccessAssignmentSubjectFilter())!,
    [asc(accessRoles.name), asc(accessAssignments.subjectType), asc(accessAssignments.createdAt)],
  );
}
async function readPrincipalAccessAssignmentSummaryRows(
  organizationId: string,
  principalId: string,
): Promise<AccessAssignmentSummaryRow[]> {
  return await readAccessAssignmentSummaryQueryRows(
    and(
      eq(accessAssignments.organizationId, organizationId),
      eq(accessAssignments.subjectType, 'principal'),
      eq(accessAssignments.subjectId, principalId),
      buildPresentAccessAssignmentSubjectFilter(),
    )!,
    [asc(accessRoles.name), asc(accessAssignments.scopeType), asc(accessAssignments.createdAt)],
  );
}
async function readAccessAssignmentSummaryQueryRows(
  where: SQL,
  orderByClauses: readonly SQL[],
): Promise<AccessAssignmentSummaryRow[]> {
  return (await getApiDatabase()
    .select(accessAssignmentSummarySelection)
    .from(accessAssignments)
    .innerJoin(accessRoles, eq(accessRoles.id, accessAssignments.roleId))
    .leftJoin(
      accessGroups,
      and(eq(accessAssignments.subjectType, 'group'), eq(accessGroups.id, accessAssignments.subjectId)),
    )
    .leftJoin(
      principals,
      and(eq(accessAssignments.subjectType, 'principal'), eq(principals.id, accessAssignments.subjectId)),
    )
    .where(where)
    .orderBy(...orderByClauses)) as AccessAssignmentSummaryRow[];
}
function buildPresentAccessAssignmentSubjectFilter(): SQL {
  return or(
    and(eq(accessAssignments.subjectType, 'group'), isNotNull(accessGroups.id)),
    and(eq(accessAssignments.subjectType, 'principal'), isNotNull(principals.id)),
  )!;
}
async function findAccessAssignmentByUniqueWithExecutor(
  executor: RbacTransaction,
  input: CreateAccessAssignmentInput,
): Promise<AccessAssignmentRow> {
  const rows: (typeof accessAssignments.$inferSelect)[] = await executor
    .select()
    .from(accessAssignments)
    .where(
      and(
        eq(accessAssignments.organizationId, input.organizationId),
        eq(accessAssignments.roleId, input.roleId),
        eq(accessAssignments.scopeId, input.scopeId),
        eq(accessAssignments.scopeType, input.scopeType),
        eq(accessAssignments.subjectId, input.subjectId),
        eq(accessAssignments.subjectType, input.subjectType),
      ),
    )
    .limit(1);

  return toAccessAssignmentRow(requireAccessAssignment(rows[0]));
}
function requireAccessAssignment(
  row: typeof accessAssignments.$inferSelect | undefined,
): typeof accessAssignments.$inferSelect {
  if (row === undefined) {
    throw new Error('Expected access assignment.');
  }
  return row;
}
const accessAssignmentSummarySelection: AccessAssignmentSummarySelection = {
  createdAt: accessAssignments.createdAt,
  groupId: accessGroups.id,
  groupName: accessGroups.name,
  id: accessAssignments.id,
  principalEmail: principals.email,
  roleId: accessRoles.id,
  roleKind: accessRoles.kind,
  roleName: accessRoles.name,
  scopeId: accessAssignments.scopeId,
  scopeType: accessAssignments.scopeType,
  subjectType: accessAssignments.subjectType,
};
