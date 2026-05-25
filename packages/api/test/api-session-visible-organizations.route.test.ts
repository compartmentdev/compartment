import {
  compartmentCurrentOrganizationHeaderName,
  compartmentOrganizationListPathname,
  compartmentWhoAmIPathname,
  errorResponseSchema,
  organizationListResponseSchema,
  whoamiResponseSchema,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import type { Actor } from '../src/services/auth-actor.types';
import type { authenticateSession } from '../src/services/authentication.service';
import type { resolveInheritedAccess } from '../src/services/access-scope.service';
import type { isAuthSessionAllowedForOrganization } from '../src/services/organization-auth-settings.service';
import type { AuthSessionOrganizationPolicySession } from '../src/services/organization-auth-settings.service.types';
import type {
  listSessionVisibleOrganizations,
  resolveOrganizationForPrincipal,
} from '../src/services/organizations.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';
import type { FilterSessionVisibleOrganizations } from './session-visible-organizations.mock';

type AuthenticateSession = typeof authenticateSession;
type IsAuthSessionAllowedForOrganization = typeof isAuthSessionAllowedForOrganization;
type ListSessionVisibleOrganizations = typeof listSessionVisibleOrganizations;
type ResolveInheritedAccess = typeof resolveInheritedAccess;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;

interface SessionVisibleOrganizationRouteMocks {
  authenticateSession: Mock<AuthenticateSession>;
  filterSessionVisibleOrganizations: Mock<FilterSessionVisibleOrganizations>;
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
  resolveInheritedAccess: Mock<ResolveInheritedAccess>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
}

interface OrganizationsServiceModuleMock {
  filterSessionVisibleOrganizations: Mock<FilterSessionVisibleOrganizations>;
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
}

const mocks: SessionVisibleOrganizationRouteMocks = vi.hoisted(
  (): SessionVisibleOrganizationRouteMocks => ({
    authenticateSession: vi.fn<AuthenticateSession>(),
    filterSessionVisibleOrganizations: vi.fn<FilterSessionVisibleOrganizations>(),
    isAuthSessionAllowedForOrganization: vi.fn<IsAuthSessionAllowedForOrganization>(),
    listSessionVisibleOrganizations: vi.fn<ListSessionVisibleOrganizations>(),
    resolveInheritedAccess: vi.fn<ResolveInheritedAccess>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
  }),
);

vi.mock('../src/services/authentication.service', (): { authenticateSession: Mock<AuthenticateSession> } => ({
  authenticateSession: mocks.authenticateSession,
}));

vi.mock(
  '../src/services/organization-auth-settings.service',
  (): { isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization> } => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
  }),
);

vi.mock('../src/services/access-scope.service', (): { resolveInheritedAccess: Mock<ResolveInheritedAccess> } => ({
  resolveInheritedAccess: mocks.resolveInheritedAccess,
}));

vi.mock(
  '../src/services/organizations.service',
  (): OrganizationsServiceModuleMock => ({
    filterSessionVisibleOrganizations: mocks.filterSessionVisibleOrganizations,
    listSessionVisibleOrganizations: mocks.listSessionVisibleOrganizations,
    resolveOrganizationForPrincipal: mocks.resolveOrganizationForPrincipal,
  }),
);

describe('session-visible organization browser API responses', (): void => {
  beforeEach((): void => {
    applyApiRouteTestEnv();
    mocks.authenticateSession.mockReset();
    mocks.filterSessionVisibleOrganizations.mockReset();
    mocks.isAuthSessionAllowedForOrganization.mockReset();
    mocks.listSessionVisibleOrganizations.mockReset();
    mocks.resolveInheritedAccess.mockReset();
    mocks.resolveOrganizationForPrincipal.mockReset();
    mocks.isAuthSessionAllowedForOrganization.mockResolvedValue(true);
  });

  it('returns every session-visible organization from /v1/orgs for password multi-org sessions', async (): Promise<void> => {
    const actor: Actor = createActor({
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_123',
    });
    mocks.authenticateSession.mockResolvedValueOnce(actor);
    mocks.listSessionVisibleOrganizations.mockResolvedValueOnce([
      createOrganizationRow('org_123'),
      createOrganizationRow('org_456'),
    ]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: createAuthorizationHeaders(),
        method: 'GET',
        url: compartmentOrganizationListPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(organizationListResponseSchema.parse(response.json()).organizations).toEqual([
        {
          id: 'org_123',
          name: 'Acme Dev',
          slug: 'acme-dev',
        },
        {
          id: 'org_456',
          name: 'Hidden Org',
          slug: 'hidden-org',
        },
      ]);
      expect(mocks.listSessionVisibleOrganizations).toHaveBeenCalledWith(actor.authSession);
    });
  });

  it('returns only the scoped organization from /v1/orgs for OIDC multi-org sessions', async (): Promise<void> => {
    const actor: Actor = createActor({
      authMethodKind: 'oidc',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    mocks.authenticateSession.mockResolvedValueOnce(actor);
    mocks.listSessionVisibleOrganizations.mockResolvedValueOnce([createOrganizationRow('org_123')]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: createAuthorizationHeaders(),
        method: 'GET',
        url: compartmentOrganizationListPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(organizationListResponseSchema.parse(response.json()).organizations).toEqual([
        {
          id: 'org_123',
          name: 'Acme Dev',
          slug: 'acme-dev',
        },
      ]);
    });
  });

  it('does not expose a hidden organization as currentOrganization from /v1/whoami', async (): Promise<void> => {
    const actor: Actor = createActor({
      authMethodKind: 'oidc',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    mocks.authenticateSession.mockResolvedValueOnce(actor);
    mocks.listSessionVisibleOrganizations.mockResolvedValueOnce([createOrganizationRow('org_123')]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          ...createAuthorizationHeaders(),
          [compartmentCurrentOrganizationHeaderName]: 'hidden-org',
        },
        method: 'GET',
        url: compartmentWhoAmIPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(whoamiResponseSchema.parse(response.json())).toEqual({
        currentOrganization: null,
        currentOrganizationPermissions: [],
        principal: {
          email: 'viewer@example.com',
          id: 'prn_123',
          type: 'user',
        },
      });
      expect(mocks.resolveInheritedAccess).not.toHaveBeenCalled();
    });
  });

  it('returns organization_not_found for hidden organizations on current-organization routes', async (): Promise<void> => {
    const actor: Actor = createActor({
      authMethodKind: 'oidc',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    const hiddenOrganization: OrganizationRow = createOrganizationRow('org_456');
    mocks.authenticateSession.mockResolvedValueOnce(actor);
    mocks.resolveOrganizationForPrincipal.mockResolvedValueOnce(hiddenOrganization);
    mocks.isAuthSessionAllowedForOrganization.mockResolvedValueOnce(false);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          ...createAuthorizationHeaders(),
          [compartmentCurrentOrganizationHeaderName]: 'hidden-org',
        },
        method: 'GET',
        url: '/v1/projects',
      });

      expect(response.statusCode).toBe(404);
      expect(errorResponseSchema.parse(response.json()).error.code).toBe('organization_not_found');
      expect(mocks.resolveOrganizationForPrincipal).toHaveBeenCalledWith('prn_123', 'hidden-org');
      expect(mocks.isAuthSessionAllowedForOrganization).toHaveBeenCalledWith({
        organizationId: 'org_456',
        session: actor.authSession,
      });
      expect(mocks.resolveInheritedAccess).not.toHaveBeenCalled();
    });
  });
});

function createAuthorizationHeaders(): Record<string, string> {
  return {
    authorization: 'Bearer session-token',
  };
}

function createActor(authSession: AuthSessionOrganizationPolicySession): Actor {
  return {
    authSession,
    principalEmail: 'viewer@example.com',
    principalId: authSession.principalId,
    principalType: 'user',
    sessionId: 'ses_123',
    tokenHash: 'session-token-hash',
  };
}

function createOrganizationRow(id: string): OrganizationRow {
  return {
    id,
    name: id === 'org_123' ? 'Acme Dev' : 'Hidden Org',
    slug: id === 'org_123' ? 'acme-dev' : 'hidden-org',
  };
}
