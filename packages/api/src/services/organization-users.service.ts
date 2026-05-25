import type { OrganizationUsersListPageResult } from '../queries/organization-users-list.query.types';
import { listOrganizationUsersPage } from '../queries/organization-users-list.query';
import { invalidateEdgeAppAccessSessions, synchronizeEdgeAppAccessState } from './app-access-edge.service';
import { revokeBlockedOrganizationUserAccess } from './organization-user-access-revocation.service';
import {
  buildOrganizationUsersListInput,
  hydrateOrganizationUserResult,
  hydrateOrganizationUserResults,
  hydrateOrganizationUserListRows,
  toOrganizationUserResult,
} from './organization-users.service.helpers';
import {
  persistOrganizationUserAccessUpdate,
  persistOrganizationUserRemoval,
} from './organization-users.service.mutations';
import type {
  ListOrganizationUsersInput,
  OrganizationUserAccessMutationInput,
  OrganizationUserListResult,
  OrganizationUserRemovalPersistenceResult,
  OrganizationUserResult,
  RemoveOrganizationUserInput,
} from './organization-users.service.types';

export async function listUsersInOrganization(input: ListOrganizationUsersInput): Promise<OrganizationUserListResult> {
  const result: OrganizationUsersListPageResult = await listOrganizationUsersPage(
    buildOrganizationUsersListInput(input),
  );
  const hydratedUsers: OrganizationUserResult[] = await hydrateOrganizationUserResults(
    input.organizationId,
    result.users.map(toOrganizationUserResult),
  );

  return {
    pagination: result.pagination,
    users: await hydrateOrganizationUserListRows(input.organizationId, hydratedUsers),
  };
}

export async function removeUserFromOrganization(input: RemoveOrganizationUserInput): Promise<OrganizationUserResult> {
  const result: OrganizationUserRemovalPersistenceResult = await persistOrganizationUserRemoval(input);
  await invalidateRevokedEdgeSessions(result.revokedSessionIds);
  await synchronizeEdgeAppAccessState();

  return result.user;
}

export async function blockUserInOrganization(
  input: OrganizationUserAccessMutationInput,
): Promise<OrganizationUserResult> {
  const user: OrganizationUserResult = await hydrateOrganizationUserResult(
    input.organizationId,
    await persistOrganizationUserAccessUpdate({
      ...input,
      blocked: true,
    }),
  );
  await revokeBlockedOrganizationUserAccess({
    organizationId: input.organizationId,
    principalId: user.id,
  });
  await synchronizeEdgeAppAccessState();

  return user;
}

export async function unblockUserInOrganization(
  input: OrganizationUserAccessMutationInput,
): Promise<OrganizationUserResult> {
  const user: OrganizationUserResult = await hydrateOrganizationUserResult(
    input.organizationId,
    await persistOrganizationUserAccessUpdate({
      ...input,
      blocked: false,
    }),
  );
  await synchronizeEdgeAppAccessState();

  return user;
}

async function invalidateRevokedEdgeSessions(authSessionIds: readonly string[]): Promise<void> {
  for (const authSessionId of authSessionIds) {
    await invalidateEdgeAppAccessSessions(authSessionId);
  }
}
