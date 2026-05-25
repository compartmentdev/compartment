import { invalidateEdgeAppAccessSessions } from './app-access-edge.service';

export async function invalidateRevokedEdgeSessions(authSessionIds: readonly string[]): Promise<void> {
  for (const authSessionId of authSessionIds) {
    try {
      await invalidateEdgeAppAccessSessions(authSessionId);
    } catch {
      // Best-effort edge invalidation should not fail the completed reset.
    }
  }
}
