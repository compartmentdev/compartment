import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  listCompartmentRolePermissions,
  organizationSettingsResponseSchema,
  type PermissionKey,
  type OrganizationSettingsResponse,
} from '@compartment/contracts';
import type { ApiApp } from '../src/app.types';
import type { Actor } from '../src/services/auth-actor.types';
import type { resolveInheritedAccess } from '../src/services/access-scope.service';
import type { recordAuditEvent } from '../src/services/audit-events.service';
import type { authenticateSession } from '../src/services/authentication.service';
import type { resolveOrganizationForPrincipal } from '../src/services/organizations.service';
import type { isAuthSessionAllowedForOrganization } from '../src/services/organization-auth-settings.service';
import type {
  readOrganizationSettings,
  updateOrganizationSettings,
} from '../src/services/organization-settings.service';
import type {
  OrganizationSettingsResult,
  UpdateOrganizationSettingsInput,
} from '../src/services/organization-settings.service.types';
import { applyApiRouteTestEnv, expectJsonError, withApiRouteApp } from './api-route-test.harness';

type AuthenticateSession = typeof authenticateSession;
type IsAuthSessionAllowedForOrganization = typeof isAuthSessionAllowedForOrganization;
type ReadOrganizationSettings = typeof readOrganizationSettings;
type RecordAuditEvent = typeof recordAuditEvent;
type ResolveInheritedAccess = typeof resolveInheritedAccess;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type UpdateOrganizationSettings = typeof updateOrganizationSettings;

interface OrganizationSettingsRouteMocks {
  authenticateSession: Mock<AuthenticateSession>;
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
  readOrganizationSettings: Mock<ReadOrganizationSettings>;
  recordAuditEvent: Mock<RecordAuditEvent>;
  resolveInheritedAccess: Mock<ResolveInheritedAccess>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  updateOrganizationSettings: Mock<UpdateOrganizationSettings>;
}

const mocks: OrganizationSettingsRouteMocks = vi.hoisted(
  (): OrganizationSettingsRouteMocks => ({
    authenticateSession: vi.fn<AuthenticateSession>(),
    isAuthSessionAllowedForOrganization: vi.fn<IsAuthSessionAllowedForOrganization>(),
    readOrganizationSettings: vi.fn<ReadOrganizationSettings>(),
    recordAuditEvent: vi.fn<RecordAuditEvent>(),
    resolveInheritedAccess: vi.fn<ResolveInheritedAccess>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    updateOrganizationSettings: vi.fn<UpdateOrganizationSettings>(),
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
  (): { isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization> } => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
  }),
);

vi.mock(
  '../src/services/organization-settings.service',
  (): {
    readOrganizationSettings: Mock<ReadOrganizationSettings>;
    updateOrganizationSettings: Mock<UpdateOrganizationSettings>;
  } => ({
    readOrganizationSettings: mocks.readOrganizationSettings,
    updateOrganizationSettings: mocks.updateOrganizationSettings,
  }),
);

vi.mock('../src/services/audit-events.service', (): { recordAuditEvent: Mock<RecordAuditEvent> } => ({
  recordAuditEvent: mocks.recordAuditEvent,
}));

describe('organization settings route', (): void => {
  afterEach((): void => {
    mocks.authenticateSession.mockReset();
    mocks.isAuthSessionAllowedForOrganization.mockReset();
    mocks.readOrganizationSettings.mockReset();
    mocks.recordAuditEvent.mockReset();
    mocks.resolveInheritedAccess.mockReset();
    mocks.resolveOrganizationForPrincipal.mockReset();
    mocks.updateOrganizationSettings.mockReset();
  });

  it('returns the current organization rollback retention settings', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();
    mocks.readOrganizationSettings.mockResolvedValueOnce(createOrganizationSettingsResult());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/organizations/settings',
      });

      expect(response.statusCode).toBe(200);
      expect(organizationSettingsResponseSchema.parse(response.json())).toEqual(createOrganizationSettingsResponse());
      expect(mocks.readOrganizationSettings).toHaveBeenCalledWith('org_123');
    });
  });

  it('returns an organization-settings validation error for invalid update payloads', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'PATCH',
        payload: {
          rollbackRetention: {
            limit: null,
            mode: 'keep_last',
          },
        },
        url: '/v1/organizations/settings',
      });

      expectJsonError(response, 400, 'invalid_organization_settings');
      expect(mocks.updateOrganizationSettings).not.toHaveBeenCalled();
    });
  });

  it('updates the current organization rollback retention settings', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();
    mocks.updateOrganizationSettings.mockResolvedValueOnce(
      createOrganizationSettingsResult({
        rollbackRetention: {
          configured: {
            limit: 3,
            mode: 'keep_last',
          },
          effective: {
            limit: 3,
            mode: 'keep_last',
          },
          instanceDefault: {
            limit: 5,
            mode: 'keep_last',
          },
        },
      }),
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'PATCH',
        payload: {
          rollbackRetention: {
            limit: 3,
            mode: 'keep_last',
          },
        },
        url: '/v1/organizations/settings',
      });

      expect(response.statusCode).toBe(200);
      expect(organizationSettingsResponseSchema.parse(response.json())).toEqual({
        settings: {
          auditRetention: {
            configured: {
              days: null,
              mode: 'inherit',
            },
            effective: {
              days: 90,
              mode: 'keep_days',
            },
            instanceDefault: {
              days: 90,
              mode: 'keep_days',
            },
          },
          rollbackRetention: {
            configured: {
              limit: 3,
              mode: 'keep_last',
            },
            effective: {
              limit: 3,
              mode: 'keep_last',
            },
            instanceDefault: {
              limit: 5,
              mode: 'keep_last',
            },
          },
        },
      });
      expect(mocks.updateOrganizationSettings).toHaveBeenCalledWith({
        actorPrincipalId: 'prn_123',
        auditRetention: undefined,
        organizationId: 'org_123',
        organizationSlug: 'acme-dev',
        rollbackRetention: {
          limit: 3,
          mode: 'keep_last',
        },
      } satisfies UpdateOrganizationSettingsInput);
    });
  });

  it('forbids rollback retention updates for principals that only have organization auth manage', async (): Promise<void> => {
    prepareAuthenticatedRouteWithPermissions(['organization.auth.manage', 'project.read', 'app.route.access']);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'PATCH',
        payload: {
          rollbackRetention: {
            limit: 3,
            mode: 'keep_last',
          },
        },
        url: '/v1/organizations/settings',
      });

      expectJsonError(response, 403, 'forbidden');
      expect(mocks.updateOrganizationSettings).not.toHaveBeenCalled();
    });
  });
});

function prepareAuthenticatedAdminRoute(): void {
  prepareAuthenticatedRouteWithPermissions(listCompartmentRolePermissions('admin'));
}

function prepareAuthenticatedRouteWithPermissions(permissions: PermissionKey[]): void {
  applyApiRouteTestEnv();
  mocks.authenticateSession.mockResolvedValue(createActor());
  mocks.isAuthSessionAllowedForOrganization.mockResolvedValue(true);
  mocks.resolveInheritedAccess.mockResolvedValue({
    grantedScopeId: 'org_123',
    grantedScopeType: 'organization',
    permissions,
  });
  mocks.resolveOrganizationForPrincipal.mockResolvedValue({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
}

function createOrganizationSettingsResult(overrides?: Partial<OrganizationSettingsResult>): OrganizationSettingsResult {
  return {
    auditRetention: {
      configured: {
        days: null,
        mode: 'inherit',
      },
      effective: {
        days: 90,
        mode: 'keep_days',
      },
      instanceDefault: {
        days: 90,
        mode: 'keep_days',
      },
    },
    rollbackRetention: {
      configured: {
        limit: null,
        mode: 'inherit',
      },
      effective: {
        limit: 5,
        mode: 'keep_last',
      },
      instanceDefault: {
        limit: 5,
        mode: 'keep_last',
      },
    },
    ...overrides,
  };
}

function createOrganizationSettingsResponse(): OrganizationSettingsResponse {
  return {
    settings: createOrganizationSettingsResult(),
  };
}

function createActor(): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_123',
    },
    memberships: [
      {
        role: 'admin',
        scopeId: 'org_123',
        scopeType: 'organization',
      },
    ],
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
