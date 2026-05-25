import {
  revokeAppAccessSessionsByAuthSessionId,
  revokeAppAccessSessionsByAuthSessionIdsWithExecutor,
} from '../queries/app-access.query';
import {
  revokeActiveAuthenticationSessionsByPrincipalIdWithExecutor,
  revokeActivePasswordSessionsByOrganization,
  revokeSession,
} from '../queries/authentication.query';
import type { OrganizationUsersTransaction } from '../queries/organization-users.query.types';
import { invalidateEdgeAppAccessSessions } from './app-access-edge.service';

export async function revokeAuthSessions(sessionIds: readonly string[]): Promise<void> {
  const uniqueSessionIds: string[] = readUniqueSessionIds(sessionIds);
  if (uniqueSessionIds.length === 0) {
    return;
  }

  const revokedAt: Date = new Date();
  await revokeStoredAuthSessions(uniqueSessionIds, revokedAt);
  const edgeInvalidationError: Error | null = await invalidateEdgeSessions(uniqueSessionIds);
  if (edgeInvalidationError !== null) {
    throw edgeInvalidationError;
  }
}

export async function revokeOrganizationPasswordSessions(organizationId: string): Promise<void> {
  const revokedAt: Date = new Date();
  const organizationSessionIds: string[] = await revokeActivePasswordSessionsByOrganization({
    organizationId,
    revokedAt,
  });

  await revokeStoredAppAccessSessions(organizationSessionIds, revokedAt);
  const edgeInvalidationError: Error | null = await invalidateEdgeSessions(organizationSessionIds);
  if (edgeInvalidationError !== null) {
    throw edgeInvalidationError;
  }
}

export async function revokePrincipalAuthSessionsWithExecutor(
  tx: OrganizationUsersTransaction,
  principalId: string,
  revokedAt: Date,
): Promise<string[]> {
  const revokedSessionIds: string[] = await revokeActiveAuthenticationSessionsByPrincipalIdWithExecutor(
    tx,
    principalId,
    revokedAt,
  );
  await revokeAppAccessSessionsByAuthSessionIdsWithExecutor(tx, revokedSessionIds, revokedAt);

  return revokedSessionIds;
}

export async function invalidateAuthSessionAppAccessSessions(sessionIds: readonly string[]): Promise<void> {
  const uniqueSessionIds: string[] = readUniqueSessionIds(sessionIds);
  const edgeInvalidationError: Error | null = await invalidateEdgeSessions(uniqueSessionIds);
  if (edgeInvalidationError !== null) {
    throw edgeInvalidationError;
  }
}

async function revokeStoredAuthSessions(sessionIds: readonly string[], revokedAt: Date): Promise<void> {
  for (const sessionId of sessionIds) {
    await revokeSession(sessionId, revokedAt);
  }

  await revokeStoredAppAccessSessions(sessionIds, revokedAt);
}

async function revokeStoredAppAccessSessions(sessionIds: readonly string[], revokedAt: Date): Promise<void> {
  for (const sessionId of sessionIds) {
    await revokeAppAccessSessionsByAuthSessionId(sessionId, revokedAt);
  }
}

async function invalidateEdgeSessions(sessionIds: readonly string[]): Promise<Error | null> {
  let firstError: Error | null = null;

  for (const sessionId of sessionIds) {
    try {
      await invalidateEdgeAppAccessSessions(sessionId);
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error('Failed to invalidate edge app access sessions.');
    }
  }

  return firstError;
}

function readUniqueSessionIds(sessionIds: readonly string[]): string[] {
  return [...new Set<string>(sessionIds)];
}
