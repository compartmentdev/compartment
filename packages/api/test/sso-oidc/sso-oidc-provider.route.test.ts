import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
  listCompartmentRolePermissions,
  type EnabledSsoOidcProvisioningPolicy,
  type SsoOidcProviderListResponse,
  type SsoOidcProviderResponse,
  type SsoOidcProviderSummary,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../../src/app.types';
import type { Actor } from '../../src/services/auth-actor.types';
import type { resolveInheritedAccess } from '../../src/services/access-scope.service';
import type { authenticateSession } from '../../src/services/authentication.service';
import type { resolveOrganizationForPrincipal } from '../../src/services/organizations.service';
import type { isAuthSessionAllowedForOrganization } from '../../src/services/organization-auth-settings.service';
import type {
  createSsoOidcProvider,
  deleteSsoOidcProvider,
  readSsoOidcProvidersForOrganization,
  updateSsoOidcProvider,
} from '../../src/services/sso-oidc/sso-oidc-provider.service';
import type { recordAuditEvent } from '../../src/services/audit-events.service';
import type { SsoOidcProviderResult } from '../../src/services/sso-oidc/sso-oidc.service.types';
import { applyApiRouteTestEnv, injectApiRoute, injectJson, withApiRouteApp } from '../api-route-test.harness';

type AuthenticateSession = typeof authenticateSession;
type CreateSsoOidcProvider = typeof createSsoOidcProvider;
type DeleteSsoOidcProvider = typeof deleteSsoOidcProvider;
type IsAuthSessionAllowedForOrganization = typeof isAuthSessionAllowedForOrganization;
type ReadSsoOidcProvidersForOrganization = typeof readSsoOidcProvidersForOrganization;
type RecordAuditEvent = typeof recordAuditEvent;
type ResolveInheritedAccess = typeof resolveInheritedAccess;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type UpdateSsoOidcProvider = typeof updateSsoOidcProvider;

interface SsoOidcProviderRouteMocks {
  authenticateSession: Mock<AuthenticateSession>;
  createSsoOidcProvider: Mock<CreateSsoOidcProvider>;
  deleteSsoOidcProvider: Mock<DeleteSsoOidcProvider>;
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
  readSsoOidcProvidersForOrganization: Mock<ReadSsoOidcProvidersForOrganization>;
  recordAuditEvent: Mock<RecordAuditEvent>;
  resolveInheritedAccess: Mock<ResolveInheritedAccess>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  updateSsoOidcProvider: Mock<UpdateSsoOidcProvider>;
}

const mocks: SsoOidcProviderRouteMocks = vi.hoisted(
  (): SsoOidcProviderRouteMocks => ({
    authenticateSession: vi.fn<AuthenticateSession>(),
    createSsoOidcProvider: vi.fn<CreateSsoOidcProvider>(),
    deleteSsoOidcProvider: vi.fn<DeleteSsoOidcProvider>(),
    isAuthSessionAllowedForOrganization: vi.fn<IsAuthSessionAllowedForOrganization>(),
    readSsoOidcProvidersForOrganization: vi.fn<ReadSsoOidcProvidersForOrganization>(),
    recordAuditEvent: vi.fn<RecordAuditEvent>(),
    resolveInheritedAccess: vi.fn<ResolveInheritedAccess>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    updateSsoOidcProvider: vi.fn<UpdateSsoOidcProvider>(),
  }),
);

vi.mock('../../src/services/authentication.service', (): { authenticateSession: Mock<AuthenticateSession> } => ({
  authenticateSession: mocks.authenticateSession,
}));

vi.mock(
  '../../src/services/organizations.service',
  (): { resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal> } => ({
    resolveOrganizationForPrincipal: mocks.resolveOrganizationForPrincipal,
  }),
);

vi.mock('../../src/services/access-scope.service', (): { resolveInheritedAccess: Mock<ResolveInheritedAccess> } => ({
  resolveInheritedAccess: mocks.resolveInheritedAccess,
}));

vi.mock(
  '../../src/services/organization-auth-settings.service',
  (): { isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization> } => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
  }),
);

vi.mock(
  '../../src/services/sso-oidc/sso-oidc-provider.service',
  (): {
    createSsoOidcProvider: Mock<CreateSsoOidcProvider>;
    deleteSsoOidcProvider: Mock<DeleteSsoOidcProvider>;
    readSsoOidcProvidersForOrganization: Mock<ReadSsoOidcProvidersForOrganization>;
    updateSsoOidcProvider: Mock<UpdateSsoOidcProvider>;
  } => ({
    createSsoOidcProvider: mocks.createSsoOidcProvider,
    deleteSsoOidcProvider: mocks.deleteSsoOidcProvider,
    readSsoOidcProvidersForOrganization: mocks.readSsoOidcProvidersForOrganization,
    updateSsoOidcProvider: mocks.updateSsoOidcProvider,
  }),
);

vi.mock('../../src/services/audit-events.service', (): { recordAuditEvent: Mock<RecordAuditEvent> } => ({
  recordAuditEvent: mocks.recordAuditEvent,
}));

describe('SSO OIDC provider routes', (): void => {
  afterEach((): void => {
    mocks.authenticateSession.mockReset();
    mocks.createSsoOidcProvider.mockReset();
    mocks.deleteSsoOidcProvider.mockReset();
    mocks.isAuthSessionAllowedForOrganization.mockReset();
    mocks.readSsoOidcProvidersForOrganization.mockReset();
    mocks.recordAuditEvent.mockReset();
    mocks.resolveInheritedAccess.mockReset();
    mocks.resolveOrganizationForPrincipal.mockReset();
    mocks.updateSsoOidcProvider.mockReset();
  });

  it('maps organization OIDC providers to the public list response', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();
    mocks.readSsoOidcProvidersForOrganization.mockResolvedValueOnce([
      createSsoOidcProviderResult('sop_google', 'Google', 'google', 'google'),
      createSsoOidcProviderResult('sop_microsoft', 'Microsoft', 'microsoft', 'generic'),
    ]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sso/oidc/providers',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<SsoOidcProviderListResponse>()).toEqual({
        providers: [
          createPublicProvider('sop_google', 'Google', 'google', 'google'),
          createPublicProvider('sop_microsoft', 'Microsoft', 'microsoft', 'generic'),
        ],
      });
    });
  });

  it('passes OIDC provider creation to the service', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();
    mocks.createSsoOidcProvider.mockResolvedValueOnce(
      createSsoOidcProviderResult('sop_123', 'Google', 'google', 'google'),
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          clientId: 'client_123',
          clientSecret: 'secret_123',
          identityVerification: createIdentityVerificationPayload(),
          key: 'google',
          preset: 'google',
          provisioning: createEnabledProvisioningPayload(),
        },
        url: '/v1/sso/oidc/providers',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<SsoOidcProviderResponse>()).toEqual({
        provider: createPublicProvider('sop_123', 'Google', 'google', 'google'),
      });
      expect(mocks.createSsoOidcProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          identityVerification: buildDefaultSsoOidcIdentityVerificationConfig(),
          key: 'google',
          provisioning: createEnabledProvisioningPolicy(),
        }),
      );
    });
  });

  it('updates an OIDC provider for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();
    mocks.updateSsoOidcProvider.mockResolvedValueOnce(
      createSsoOidcProviderResult('sop_123', 'Workspace SSO', 'workspace', 'generic'),
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectJson(app, {
        headers: createAuthenticatedHeaders(),
        method: 'PATCH',
        payload: {
          displayName: 'Workspace SSO',
        },
        url: '/v1/sso/oidc/providers/sop_123',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<SsoOidcProviderResponse>()).toEqual({
        provider: createPublicProvider('sop_123', 'Workspace SSO', 'workspace', 'generic'),
      });
    });
  });

  it('deletes an OIDC provider for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedAdminRoute();
    mocks.deleteSsoOidcProvider.mockResolvedValueOnce(
      createSsoOidcProviderResult('sop_123', 'Workspace SSO', 'workspace', 'generic'),
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'DELETE',
        url: '/v1/sso/oidc/providers/sop_123',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
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

function createPublicProvider(
  id: string,
  displayName: string,
  key: string,
  preset: 'generic' | 'google',
): SsoOidcProviderSummary {
  return {
    buttonText: `Login with ${displayName}`,
    clientId: 'client_123',
    createdAt: '2026-04-21T10:00:00.000Z',
    displayName,
    id,
    identityVerification: buildDefaultSsoOidcIdentityVerificationConfig(),
    issuerUrl: preset === 'google' ? 'https://accounts.google.com' : 'https://login.example.com',
    key,
    preset,
    provisioning: buildDisabledSsoOidcProvisioningPolicy(),
    scope: 'openid email profile',
    updatedAt: '2026-04-21T10:05:00.000Z',
  };
}

function createSsoOidcProviderResult(
  id: string,
  displayName: string,
  key: string,
  preset: 'generic' | 'google',
): SsoOidcProviderResult {
  return {
    buttonText: `Login with ${displayName}`,
    clientId: 'client_123',
    createdAt: new Date('2026-04-21T10:00:00.000Z'),
    displayName,
    id,
    identityVerification: buildDefaultSsoOidcIdentityVerificationConfig(),
    issuerUrl: preset === 'google' ? 'https://accounts.google.com' : 'https://login.example.com',
    key,
    preset,
    provisioning: buildDisabledSsoOidcProvisioningPolicy(),
    scope: 'openid email profile',
    updatedAt: new Date('2026-04-21T10:05:00.000Z'),
  };
}

function createIdentityVerificationPayload(): Record<string, JsonValue> {
  return {
    emailClaims: [{ claim: 'email', source: 'id_token' }],
    emailVerifiedClaims: [{ claim: 'email_verified', equals: true, source: 'id_token' }],
    verifiedEmailClaims: [],
  };
}

function createEnabledProvisioningPolicy(): EnabledSsoOidcProvisioningPolicy {
  return {
    allowedEmailDomains: ['example.com', 'example.dev', 'example.net'],
    autoJoinEnabled: true,
    defaultRole: 'viewer',
  };
}

function createEnabledProvisioningPayload(): Record<string, JsonValue> {
  const provisioning: EnabledSsoOidcProvisioningPolicy = createEnabledProvisioningPolicy();

  return {
    allowedEmailDomains: [...provisioning.allowedEmailDomains],
    autoJoinEnabled: provisioning.autoJoinEnabled,
    defaultRole: provisioning.defaultRole,
  };
}
