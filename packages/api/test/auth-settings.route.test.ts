import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { listCompartmentRolePermissions } from '@compartment/contracts';
import type { ApiApp } from '../src/app.types';
import type { Actor } from '../src/services/auth-actor.types';
import type { resolveInheritedAccess } from '../src/services/access-scope.service';
import type { authenticateSession } from '../src/services/authentication.service';
import type { resolveOrganizationForPrincipal } from '../src/services/organizations.service';
import type {
  isAuthSessionAllowedForOrganization,
  readOrganizationAuthSettings,
  updateOrganizationAuthSettings,
} from '../src/services/organization-auth-settings.service';
import { applyApiRouteTestEnv, expectJsonError, withApiRouteApp } from './api-route-test.harness';

type AuthenticateSession = typeof authenticateSession;
type IsAuthSessionAllowedForOrganization = typeof isAuthSessionAllowedForOrganization;
type ReadOrganizationAuthSettings = typeof readOrganizationAuthSettings;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type ResolveInheritedAccess = typeof resolveInheritedAccess;
type UpdateOrganizationAuthSettings = typeof updateOrganizationAuthSettings;

interface AuthSettingsRouteMocks {
  authenticateSession: Mock<AuthenticateSession>;
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
  readOrganizationAuthSettings: Mock<ReadOrganizationAuthSettings>;
  resolveInheritedAccess: Mock<ResolveInheritedAccess>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  updateOrganizationAuthSettings: Mock<UpdateOrganizationAuthSettings>;
}

const mocks: AuthSettingsRouteMocks = vi.hoisted(
  (): AuthSettingsRouteMocks => ({
    authenticateSession: vi.fn<AuthenticateSession>(),
    isAuthSessionAllowedForOrganization: vi.fn<IsAuthSessionAllowedForOrganization>(),
    readOrganizationAuthSettings: vi.fn<ReadOrganizationAuthSettings>(),
    resolveInheritedAccess: vi.fn<ResolveInheritedAccess>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    updateOrganizationAuthSettings: vi.fn<UpdateOrganizationAuthSettings>(),
  }),
);

vi.mock('../src/services/authentication.service', (): { authenticateSession: Mock<AuthenticateSession> } => ({
  authenticateSession: mocks.authenticateSession,
}));

vi.mock(
  '../src/services/organizations.service',
  (): { resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal> } => ({
    resolveOrganizationForPrincipal: mocks.resolveOrganizationForPrincipal,
  }),
);

vi.mock('../src/services/access-scope.service', (): { resolveInheritedAccess: Mock<ResolveInheritedAccess> } => ({
  resolveInheritedAccess: mocks.resolveInheritedAccess,
}));

vi.mock(
  '../src/services/organization-auth-settings.service',
  (): {
    isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
    readOrganizationAuthSettings: Mock<ReadOrganizationAuthSettings>;
    updateOrganizationAuthSettings: Mock<UpdateOrganizationAuthSettings>;
  } => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
    readOrganizationAuthSettings: mocks.readOrganizationAuthSettings,
    updateOrganizationAuthSettings: mocks.updateOrganizationAuthSettings,
  }),
);

describe('auth settings route', (): void => {
  afterEach((): void => {
    mocks.authenticateSession.mockReset();
    mocks.isAuthSessionAllowedForOrganization.mockReset();
    mocks.readOrganizationAuthSettings.mockReset();
    mocks.resolveInheritedAccess.mockReset();
    mocks.resolveOrganizationForPrincipal.mockReset();
    mocks.updateOrganizationAuthSettings.mockReset();
  });

  it('returns an auth-settings validation error for invalid update payloads', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'PATCH',
        payload: {
          localPasswordEnabled: 'nope',
        },
        url: '/v1/auth/settings',
      });

      expectJsonError(response, 400, 'invalid_auth_settings');
      expect(mocks.updateOrganizationAuthSettings).not.toHaveBeenCalled();
    });
  });

  it('returns not found for current-organization routes when the session cannot see the selected organization', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();
    mocks.isAuthSessionAllowedForOrganization.mockResolvedValueOnce(false);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/auth/settings',
      });

      expectJsonError(response, 404, 'organization_not_found');
      expect(mocks.readOrganizationAuthSettings).not.toHaveBeenCalled();
      expect(mocks.updateOrganizationAuthSettings).not.toHaveBeenCalled();
    });
  });
});

function prepareAuthenticatedAdminRoute(): void {
  applyApiRouteTestEnv();
  mocks.authenticateSession.mockResolvedValue(createActor());
  mocks.isAuthSessionAllowedForOrganization.mockResolvedValue(true);
  mocks.resolveInheritedAccess.mockResolvedValue({
    grantedScopeId: 'org_123',
    grantedScopeType: 'organization',
    permissions: listCompartmentRolePermissions('admin'),
  });
  mocks.resolveOrganizationForPrincipal.mockResolvedValue({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
}

function createActor(): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_123',
    },
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    principalType: 'user',
    sessionId: 'ses_123',
    tokenHash: 'hashed-session-token',
  };
}

function createAuthenticatedHeaders(): Record<string, string> {
  return {
    authorization: 'Bearer session-token',
    'x-compartment-organization': 'acme-dev',
  };
}
