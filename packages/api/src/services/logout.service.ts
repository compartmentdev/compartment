import { revokeSession } from '../queries/authentication.query';
import { revokeAppAccessSessionsByAuthSessionId } from '../queries/app-access.query';
import { insertOperationRecord } from '../queries/operations.query';
import { invalidateEdgeAppAccessSessions } from './app-access-edge.service';
import type { Actor } from './auth-actor.types';

export async function logout(actor: Actor): Promise<void> {
  const now: Date = new Date();
  await revokeSession(actor.sessionId, now);
  await revokeAppAccessSessionsByAuthSessionId(actor.sessionId, now);
  await tryInvalidateEdgeAppAccessSessions(actor.sessionId);
  await insertOperationRecord({
    actorPrincipalId: actor.principalId,
    completedAt: now,
    organizationId: actor.authSession.organizationId,
    status: 'succeeded',
    summary: `Logged out ${actor.principalEmail}`,
    targetId: actor.sessionId,
    targetType: 'session',
    type: 'auth.logout',
  });
}

async function tryInvalidateEdgeAppAccessSessions(authSessionId: string): Promise<void> {
  try {
    await invalidateEdgeAppAccessSessions(authSessionId);
  } catch {
    return;
  }
}
