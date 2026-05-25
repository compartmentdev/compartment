import type { CreateAccessAssignmentRequest } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import {
  createAccessGroupNotFoundError,
  createAccessRoleNotFoundError,
  createUserNotFoundError,
} from '../errors/api-business-error';
import { findOrganizationUserByEmailWithExecutor } from '../queries/organization-users.query';
import type { OrganizationUserRow } from '../queries/organization-users.query.types';
import { createAccessAssignmentWithExecutor } from '../queries/rbac-assignments.query';
import { findAccessGroupByIdWithExecutor } from '../queries/rbac-groups.query';
import { findAccessRoleByIdWithExecutor } from '../queries/rbac-roles.query';
import type {
  AccessGroupRow,
  AccessRoleRow,
  CreateAccessAssignmentResult,
  RbacTransaction,
} from '../queries/rbac.query.types';
import { buildCreatedAccessAssignmentResult } from './access-assignments.service.helpers';
import type {
  AccessAssignmentMutationResult,
  AccessAssignmentSubjectResult,
  CreateOrganizationAccessAssignmentInput,
} from './access-assignments.service.types';
import { runOrganizationAccessMutationTransaction } from './rbac-admin-invariant.service';
import type { RbacGrantablePermissionsScope } from './rbac-admin-invariant.service.types';
import { assertPrincipalCanGrantPermissionsWithExecutor } from './rbac-grantability.service';
import { resolveStoredScopeTarget } from './rbac-scope-target.service';

interface ResolvedAccessAssignmentSubject {
  subjectId: string;
  subjectType: 'group' | 'principal';
  summary: AccessAssignmentSubjectResult;
}

interface StoredAccessAssignmentResult {
  result: CreateAccessAssignmentResult;
  role: AccessRoleRow;
  subject: ResolvedAccessAssignmentSubject;
}

export async function createOrganizationAccessAssignment(
  input: CreateOrganizationAccessAssignmentInput,
): Promise<AccessAssignmentMutationResult> {
  const request: CreateAccessAssignmentRequest = input.request;
  const scope: RbacGrantablePermissionsScope = await resolveStoredScopeTarget(input.organizationId, request.scope);
  const { result, role, subject }: StoredAccessAssignmentResult = await createStoredAccessAssignment(input, scope);

  return {
    assignment: buildCreatedAccessAssignmentResult({
      assignment: result.assignment,
      role,
      scope: request.scope,
      subject: subject.summary,
    }),
    created: result.created,
  };
}

async function createStoredAccessAssignment(
  input: CreateOrganizationAccessAssignmentInput,
  scope: RbacGrantablePermissionsScope,
): Promise<StoredAccessAssignmentResult> {
  let result: CreateAccessAssignmentResult | undefined;
  let role: AccessRoleRow | undefined;
  let subject: ResolvedAccessAssignmentSubject | undefined;

  await runOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    mutation: async (tx: RbacTransaction): Promise<void> => {
      ({ result, role, subject } = await createStoredAccessAssignmentWithExecutor(tx, input, scope));
    },
  });

  return {
    result: requireCreateAccessAssignmentResult(result),
    role: requireAccessRoleResult(role),
    subject: requireResolvedAccessAssignmentSubject(subject),
  };
}

async function createStoredAccessAssignmentWithExecutor(
  tx: RbacTransaction,
  input: CreateOrganizationAccessAssignmentInput,
  scope: RbacGrantablePermissionsScope,
): Promise<Partial<StoredAccessAssignmentResult>> {
  const role: AccessRoleRow = await requireAccessRole(tx, input.organizationId, input.request.roleId);
  await assertAccessAssignmentRoleIsGrantable(tx, input, scope, role);
  const subject: ResolvedAccessAssignmentSubject = await resolveAssignmentSubject(
    tx,
    input.organizationId,
    input.request,
  );
  const result: CreateAccessAssignmentResult = await createAccessAssignmentWithExecutor(tx, {
    id: createId('asg'),
    organizationId: input.organizationId,
    roleId: role.id,
    scopeId: scope.scopeId,
    scopeType: scope.scopeType,
    subjectId: subject.subjectId,
    subjectType: subject.subjectType,
  });

  return { result, role, subject };
}

async function assertAccessAssignmentRoleIsGrantable(
  tx: RbacTransaction,
  input: CreateOrganizationAccessAssignmentInput,
  scope: RbacGrantablePermissionsScope,
  role: AccessRoleRow,
): Promise<void> {
  await assertPrincipalCanGrantPermissionsWithExecutor(tx, {
    actorPrincipalId: input.actorPrincipalId,
    organizationId: input.organizationId,
    permissionKeys: role.permissionKeys,
    scope,
  });
}

async function resolveAssignmentSubject(
  tx: RbacTransaction,
  organizationId: string,
  request: CreateAccessAssignmentRequest,
): Promise<ResolvedAccessAssignmentSubject> {
  switch (request.subject.subjectType) {
    case 'group':
      return await resolveGroupAssignmentSubject(tx, organizationId, request.subject.groupId);
    case 'principal':
      return await resolvePrincipalAssignmentSubject(tx, organizationId, request.subject.principalEmail);
  }
}

async function resolveGroupAssignmentSubject(
  tx: RbacTransaction,
  organizationId: string,
  groupId: string,
): Promise<ResolvedAccessAssignmentSubject> {
  const group: AccessGroupRow = await requireAccessGroup(tx, organizationId, groupId);

  return {
    subjectId: group.id,
    subjectType: 'group',
    summary: { groupId: group.id, groupName: group.name, subjectType: 'group' },
  };
}

async function resolvePrincipalAssignmentSubject(
  tx: RbacTransaction,
  organizationId: string,
  principalEmail: string,
): Promise<ResolvedAccessAssignmentSubject> {
  const user: OrganizationUserRow | undefined = await findOrganizationUserByEmailWithExecutor(
    tx,
    organizationId,
    principalEmail,
  );
  if (user === undefined) {
    throw createUserNotFoundError();
  }

  return {
    subjectId: user.id,
    subjectType: 'principal',
    summary: { principalEmail: user.email, subjectType: 'principal' },
  };
}

async function requireAccessGroup(
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

async function requireAccessRole(tx: RbacTransaction, organizationId: string, roleId: string): Promise<AccessRoleRow> {
  const role: AccessRoleRow | undefined = await findAccessRoleByIdWithExecutor(tx, organizationId, roleId);
  if (role === undefined) {
    throw createAccessRoleNotFoundError();
  }

  return role;
}

function requireCreateAccessAssignmentResult(
  result: CreateAccessAssignmentResult | undefined,
): CreateAccessAssignmentResult {
  if (result === undefined) {
    throw new Error('Expected access assignment result.');
  }

  return result;
}

function requireAccessRoleResult(role: AccessRoleRow | undefined): AccessRoleRow {
  if (role === undefined) {
    throw new Error('Expected access role.');
  }

  return role;
}

function requireResolvedAccessAssignmentSubject(
  subject: ResolvedAccessAssignmentSubject | undefined,
): ResolvedAccessAssignmentSubject {
  if (subject === undefined) {
    throw new Error('Expected access assignment subject.');
  }

  return subject;
}
