import type { PermissionKey } from '@compartment/contracts';
import {
  createSelfAdminMembershipChangeForbiddenError,
  createUserNotManageableError,
  createUserNotFoundError,
} from '../errors/api-business-error';
import { countOrganizationMembershipsForPrincipalWithExecutor } from '../queries/organization-memberships.query';
import {
  deletePrincipalAssignmentsWithExecutor,
  listDirectPrincipalPermissionGrantRowsWithExecutor,
  listGroupPrincipalPermissionGrantRowsWithExecutor,
} from '../queries/rbac-assignments.query';
import { deletePrincipalAccessGroupMembershipsWithExecutor } from '../queries/rbac-groups.query';
import {
  findOrganizationUserByEmail,
  findOrganizationUserByEmailWithExecutor,
} from '../queries/organization-users.query';
import {
  removeOrganizationMembershipWithExecutor,
  updateOrganizationMembershipBlockWithExecutor,
} from '../queries/organization-membership-mutations.query';
import type { OrganizationUserRow, OrganizationUsersTransaction } from '../queries/organization-users.query.types';
import { insertOperationRecordWithExecutor } from '../queries/operations.query';
import { clearLocalCredentialStateByPrincipalIdWithExecutor } from '../queries/principal-credentials.query';
import {
  deleteSsoOidcIdentitiesByPrincipalIdAndOrganizationIdWithExecutor,
  deleteSsoOidcIdentitiesByPrincipalIdWithExecutor,
} from '../queries/sso-oidc.query';
import { revokePrincipalAuthSessionsWithExecutor } from './auth-session-revocation.service';
import {
  buildBlockOperation,
  buildRemoveOperation,
  buildUnblockOperation,
  toOrganizationUserResult,
} from './organization-users.service.helpers';
import type {
  OrganizationUserResult,
  OrganizationUserRemovalPersistenceResult,
  RemoveOrganizationUserInput,
  UpdateOrganizationUserAccessInput,
} from './organization-users.service.types';
import { hasOrganizationAdminPathPermissions } from './rbac-admin-path.service';
import { runPrincipalScopedOrganizationAccessMutationTransaction } from './rbac-admin-invariant.service';

export async function persistOrganizationUserRemoval(
  input: RemoveOrganizationUserInput,
): Promise<OrganizationUserRemovalPersistenceResult> {
  const candidateUser: OrganizationUserRow = await requireOrganizationUserForPrincipalScopedMutation(
    input.organizationId,
    input.email,
  );

  return await runPrincipalScopedOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    principalId: candidateUser.id,
    mutation: async (tx: OrganizationUsersTransaction): Promise<OrganizationUserRemovalPersistenceResult> =>
      await removeOrganizationUserInTransaction(tx, input),
  });
}

async function removeOrganizationUserInTransaction(
  tx: OrganizationUsersTransaction,
  input: RemoveOrganizationUserInput,
): Promise<OrganizationUserRemovalPersistenceResult> {
  const user: OrganizationUserRow = await requireOrganizationUser(tx, input.organizationId, input.email);

  await assertCanChangeOrganizationManagers(tx, input.actorPrincipalId, input.organizationId, user.id);
  await removeOrganizationMembershipWithExecutor(tx, {
    organizationId: input.organizationId,
    principalId: user.id,
  });
  const revokedSessionIds: string[] = await removeOrganizationUserAccessArtifacts(
    tx,
    input.organizationId,
    user.id,
    new Date(),
  );
  await insertOperationRecordWithExecutor(tx, buildRemoveOperation(input, user.id));

  return { revokedSessionIds, user: toOrganizationUserResult(user) };
}

export async function persistOrganizationUserAccessUpdate(
  input: UpdateOrganizationUserAccessInput,
): Promise<OrganizationUserResult> {
  const candidateUser: OrganizationUserRow = await requireOrganizationUserForPrincipalScopedMutation(
    input.organizationId,
    input.email,
  );

  return await runPrincipalScopedOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    principalId: candidateUser.id,
    mutation: async (tx: OrganizationUsersTransaction): Promise<OrganizationUserResult> =>
      await updateOrganizationUserAccessInTransaction(tx, input),
  });
}

async function updateOrganizationUserAccessInTransaction(
  tx: OrganizationUsersTransaction,
  input: UpdateOrganizationUserAccessInput,
): Promise<OrganizationUserResult> {
  const user: OrganizationUserRow = await requireOrganizationUser(tx, input.organizationId, input.email);

  if (input.blocked) {
    await assertCanChangeOrganizationManagers(tx, input.actorPrincipalId, input.organizationId, user.id);
  }
  await updateOrganizationMembershipBlockWithExecutor(tx, {
    blockedAt: input.blocked ? new Date() : null,
    organizationId: input.organizationId,
    principalId: user.id,
  });
  await insertOperationRecordWithExecutor(
    tx,
    input.blocked ? buildBlockOperation(input, user.id) : buildUnblockOperation(input, user.id),
  );
  return buildUpdatedOrganizationUserResult(user, input.blocked);
}

async function requireOrganizationUserForPrincipalScopedMutation(
  organizationId: string,
  email: string,
): Promise<OrganizationUserRow> {
  const user: OrganizationUserRow | undefined = await findOrganizationUserByEmail(organizationId, email);
  if (user === undefined) {
    throw createUserNotFoundError();
  }
  if (user.type !== 'user') {
    throw createUserNotManageableError();
  }

  return user;
}

async function requireOrganizationUser(
  tx: OrganizationUsersTransaction,
  organizationId: string,
  email: string,
): Promise<OrganizationUserRow> {
  const user: OrganizationUserRow | undefined = await findOrganizationUserByEmailWithExecutor(
    tx,
    organizationId,
    email,
  );
  if (user === undefined) {
    throw createUserNotFoundError();
  }
  if (user.type !== 'user') {
    throw createUserNotManageableError();
  }

  return user;
}

async function assertCanChangeOrganizationManagers(
  tx: OrganizationUsersTransaction,
  actorPrincipalId: string,
  organizationId: string,
  principalId: string,
): Promise<void> {
  if (!(await hasOrganizationAdminPath(tx, organizationId, principalId))) {
    return;
  }
  if (principalId === actorPrincipalId) {
    throw createSelfAdminMembershipChangeForbiddenError();
  }
}

async function hasOrganizationAdminPath(
  tx: OrganizationUsersTransaction,
  organizationId: string,
  principalId: string,
): Promise<boolean> {
  const directPermissions: PermissionKey[] = (
    await listDirectPrincipalPermissionGrantRowsWithExecutor(tx, organizationId, principalId)
  )
    .filter(isOrganizationPermissionGrant)
    .map((row: { permissionKey: PermissionKey }): PermissionKey => row.permissionKey);
  const groupPermissions: PermissionKey[] = (
    await listGroupPrincipalPermissionGrantRowsWithExecutor(tx, organizationId, principalId)
  )
    .filter(isOrganizationPermissionGrant)
    .map((row: { permissionKey: PermissionKey }): PermissionKey => row.permissionKey);

  return hasOrganizationAdminPathPermissions([...directPermissions, ...groupPermissions]);
}

function isOrganizationPermissionGrant(row: { scopeType: string; scopeId: string }): boolean {
  return row.scopeType === 'organization';
}

async function removeOrganizationUserAccessArtifacts(
  tx: OrganizationUsersTransaction,
  organizationId: string,
  principalId: string,
  removedAt: Date,
): Promise<string[]> {
  await deletePrincipalAssignmentsWithExecutor(tx, organizationId, principalId);
  await deletePrincipalAccessGroupMembershipsWithExecutor(tx, organizationId, principalId);
  await deleteSsoOidcIdentitiesByPrincipalIdAndOrganizationIdWithExecutor(tx, principalId, organizationId);
  return await purgeLiveAuthenticationStateIfLastMembership(tx, principalId, removedAt);
}

function buildUpdatedOrganizationUserResult(user: OrganizationUserRow, blocked: boolean): OrganizationUserResult {
  return {
    ...toOrganizationUserResult(user),
    access: blocked ? 'blocked' : 'allowed',
  };
}

async function purgeLiveAuthenticationStateIfLastMembership(
  tx: OrganizationUsersTransaction,
  principalId: string,
  removedAt: Date,
): Promise<string[]> {
  const remainingMembershipCount: number = await countOrganizationMembershipsForPrincipalWithExecutor(tx, principalId);
  if (remainingMembershipCount > 0) {
    return [];
  }

  await deleteSsoOidcIdentitiesByPrincipalIdWithExecutor(tx, principalId);
  await clearLocalCredentialStateByPrincipalIdWithExecutor(tx, principalId, removedAt);
  return await revokePrincipalAuthSessionsWithExecutor(tx, principalId, removedAt);
}
