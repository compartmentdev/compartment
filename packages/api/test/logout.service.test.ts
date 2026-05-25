import { describe, expect, it, vi, type Mock } from 'vitest';
import type { revokeSession } from '../src/queries/authentication.query';
import type { revokeAppAccessSessionsByAuthSessionId } from '../src/queries/app-access.query';
import type { insertOperationRecord } from '../src/queries/operations.query';
import { logout } from '../src/services/logout.service';
import type { invalidateEdgeAppAccessSessions } from '../src/services/app-access-edge.service';
import type { Actor } from '../src/services/auth-actor.types';

type InsertOperationRecord = typeof insertOperationRecord;
type InvalidateEdgeAppAccessSessions = typeof invalidateEdgeAppAccessSessions;
type RevokeAppAccessSessionsByAuthSessionId = typeof revokeAppAccessSessionsByAuthSessionId;
type RevokeSession = typeof revokeSession;

interface LogoutServiceMocks {
  insertOperationRecord: Mock<InsertOperationRecord>;
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  revokeAppAccessSessionsByAuthSessionId: Mock<RevokeAppAccessSessionsByAuthSessionId>;
  revokeSession: Mock<RevokeSession>;
}

const mocks: LogoutServiceMocks = vi.hoisted(
  (): LogoutServiceMocks => ({
    insertOperationRecord: vi.fn<InsertOperationRecord>(),
    invalidateEdgeAppAccessSessions: vi.fn<InvalidateEdgeAppAccessSessions>(),
    revokeAppAccessSessionsByAuthSessionId: vi.fn<RevokeAppAccessSessionsByAuthSessionId>(),
    revokeSession: vi.fn<RevokeSession>(),
  }),
);

vi.mock('../src/queries/authentication.query', (): { revokeSession: Mock<RevokeSession> } => ({
  revokeSession: mocks.revokeSession,
}));

vi.mock(
  '../src/queries/app-access.query',
  (): { revokeAppAccessSessionsByAuthSessionId: Mock<RevokeAppAccessSessionsByAuthSessionId> } => ({
    revokeAppAccessSessionsByAuthSessionId: mocks.revokeAppAccessSessionsByAuthSessionId,
  }),
);

vi.mock('../src/queries/operations.query', (): { insertOperationRecord: Mock<InsertOperationRecord> } => ({
  insertOperationRecord: mocks.insertOperationRecord,
}));

vi.mock(
  '../src/services/app-access-edge.service',
  (): { invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions> } => ({
    invalidateEdgeAppAccessSessions: mocks.invalidateEdgeAppAccessSessions,
  }),
);

const actor: Actor = {
  authSession: {
    authMethodKind: 'password',
    oidcProviderId: null,
    organizationId: null,
    principalId: 'prn_123',
  },
  memberships: [],
  principalEmail: 'admin@example.com',
  principalId: 'prn_123',
  principalType: 'user',
  sessionId: 'ses_123',
  tokenHash: 'token-hash',
};

describe('logout service', (): void => {
  it('records logout after revoking session state', async (): Promise<void> => {
    await logout(actor);

    expect(mocks.revokeSession).toHaveBeenCalledTimes(1);
    expect(mocks.revokeAppAccessSessionsByAuthSessionId).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateEdgeAppAccessSessions).toHaveBeenCalledWith('ses_123');
    expect(mocks.insertOperationRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actorPrincipalId: 'prn_123',
        status: 'succeeded',
        summary: 'Logged out admin@example.com',
        targetId: 'ses_123',
        targetType: 'session',
        type: 'auth.logout',
      }),
    );
  });

  it('keeps logout successful when edge session invalidation fails', async (): Promise<void> => {
    mocks.invalidateEdgeAppAccessSessions.mockRejectedValueOnce(new Error('edge unavailable'));

    await expect(logout(actor)).resolves.toBeUndefined();

    expect(mocks.revokeSession).toHaveBeenCalledTimes(1);
    expect(mocks.revokeAppAccessSessionsByAuthSessionId).toHaveBeenCalledTimes(1);
    expect(mocks.insertOperationRecord).toHaveBeenCalledTimes(1);
  });
});
