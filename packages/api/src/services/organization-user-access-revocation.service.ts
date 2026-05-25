import { revokeBlockedOrganizationUserAppAccessSessions } from '../queries/app-access.query';
import { listActiveAuthenticationSessionIdsForBlockedOrganizationUser } from '../queries/blocked-organization-user-sessions.query';
import { getApiConfig } from '../runtime/runtime-access';
import { invalidateAuthSessionAppAccessSessions, revokeAuthSessions } from './auth-session-revocation.service';

interface RevokeBlockedOrganizationUserAccessInput {
  organizationId: string;
  principalId: string;
}

export async function revokeBlockedOrganizationUserAccess(
  input: RevokeBlockedOrganizationUserAccessInput,
): Promise<void> {
  const revokedAt: Date = new Date();
  const authSessionIds: string[] = await listActiveAuthenticationSessionIdsForBlockedOrganizationUser({
    activeAt: revokedAt,
    organizationId: input.organizationId,
    principalId: input.principalId,
  });
  const appAccessAuthSessionIds: string[] = await revokeBlockedOrganizationUserAppAccessSessions({
    baseDomain: getApiConfig().baseDomain,
    organizationId: input.organizationId,
    principalId: input.principalId,
    revokedAt,
  });

  await revokeAuthSessions(authSessionIds);
  await invalidateAuthSessionAppAccessSessions(
    readAppAccessOnlyAuthSessionIds(appAccessAuthSessionIds, authSessionIds),
  );
}

function readAppAccessOnlyAuthSessionIds(
  appAccessAuthSessionIds: readonly string[],
  authSessionIds: readonly string[],
): string[] {
  const revokedAuthSessionIds: Set<string> = new Set<string>(authSessionIds);
  return appAccessAuthSessionIds.filter((authSessionId: string): boolean => !revokedAuthSessionIds.has(authSessionId));
}
