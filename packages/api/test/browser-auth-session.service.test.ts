import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Actor } from '../src/services/auth-actor.types';
import type { AuthSessionActorRow } from '../src/queries/authentication.query.types';
import type { authenticateSession } from '../src/services/authentication.service';
import type { findActiveAuthenticationSessionById } from '../src/queries/authentication.query';
import type { isAuthSessionAllowedForOrganization } from '../src/services/organization-auth-settings.service';
import type { BrowserCompartmentSession } from '../src/services/app-access.service.types';
import { authenticateBrowserCompartmentSession } from '../src/services/app-access.service';

type AuthenticateSession = typeof authenticateSession;
type FindActiveAuthenticationSessionById = typeof findActiveAuthenticationSessionById;
type IsAuthSessionAllowedForOrganization = typeof isAuthSessionAllowedForOrganization;

interface BrowserAuthSessionServiceMocks {
  authenticateSession: Mock<AuthenticateSession>;
  findActiveAuthenticationSessionById: Mock<FindActiveAuthenticationSessionById>;
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
}

const mocks: BrowserAuthSessionServiceMocks = vi.hoisted(
  (): BrowserAuthSessionServiceMocks => ({
    authenticateSession: vi.fn<AuthenticateSession>(),
    findActiveAuthenticationSessionById: vi.fn<FindActiveAuthenticationSessionById>(),
    isAuthSessionAllowedForOrganization: vi.fn<IsAuthSessionAllowedForOrganization>(),
  }),
);

vi.mock('../src/services/authentication.service', (): { authenticateSession: Mock<AuthenticateSession> } => ({
  authenticateSession: mocks.authenticateSession,
}));

vi.mock(
  '../src/queries/authentication.query',
  (): { findActiveAuthenticationSessionById: Mock<FindActiveAuthenticationSessionById> } => ({
    findActiveAuthenticationSessionById: mocks.findActiveAuthenticationSessionById,
  }),
);

vi.mock(
  '../src/services/organization-auth-settings.service',
  (): { isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization> } => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
  }),
);

describe('browser auth session service', (): void => {
  beforeEach((): void => {
    mocks.authenticateSession.mockResolvedValue(createActor());
    mocks.findActiveAuthenticationSessionById.mockResolvedValue(createAuthSessionActorRow());
    mocks.isAuthSessionAllowedForOrganization.mockResolvedValue(true);
  });

  it('returns the browser session when the stored organization policy still allows it', async (): Promise<void> => {
    const session: BrowserCompartmentSession | null =
      await authenticateBrowserCompartmentSession('browser-session-token');

    expect(session).toEqual({
      authSession: {
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId: 'org_123',
        principalId: 'prn_123',
      },
      expiresAt: new Date('2099-03-31T00:00:00.000Z'),
      principalEmail: 'admin@example.com',
      principalId: 'prn_123',
      sessionId: 'ses_123',
      sessionToken: 'browser-session-token',
    });
  });

  it('drops the browser session when the organization policy no longer allows it', async (): Promise<void> => {
    mocks.isAuthSessionAllowedForOrganization.mockResolvedValueOnce(false);

    const session: BrowserCompartmentSession | null =
      await authenticateBrowserCompartmentSession('browser-session-token');

    expect(session).toBeNull();
  });

  it('drops browser sessions that are not scoped to an organization', async (): Promise<void> => {
    mocks.findActiveAuthenticationSessionById.mockResolvedValueOnce(
      createAuthSessionActorRow({
        organizationId: null,
      }),
    );

    const session: BrowserCompartmentSession | null =
      await authenticateBrowserCompartmentSession('browser-session-token');

    expect(session).toBeNull();
    expect(mocks.isAuthSessionAllowedForOrganization).not.toHaveBeenCalled();
  });
});

function createActor(): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: 'org_123',
      principalId: 'prn_123',
    },
    memberships: [],
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    principalType: 'user',
    sessionId: 'ses_123',
    tokenHash: 'hashed-session-token',
  };
}

function createAuthSessionActorRow(overrides: Partial<AuthSessionActorRow> = {}): AuthSessionActorRow {
  return {
    authMethodKind: 'password',
    expiresAt: new Date('2099-03-31T00:00:00.000Z'),
    oidcProviderId: null,
    organizationId: 'org_123',
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    principalType: 'user',
    sessionId: 'ses_123',
    ...overrides,
  };
}
