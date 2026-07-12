import {
  activateStateResponseSchema,
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
  compartmentCurrentOrganizationHeaderName,
  createOrganizationResponseSchema,
  errorResponseSchema,
  inviteUserResponseSchema,
  type ActivateStateResponse,
  type InstallResponse,
  type InviteUserResponse,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { authSessions, localCredentials, organizations, principals, ssoOidcProviders } from '../src/db/schema';
import { hashToken } from '../src/lib/tokens';
import { authApiActivatePathname, authApiActivateStatePathname } from '../src/routes/auth/auth-api-paths';
import {
  buildOrganizationAuthorizationHeaders,
  installCompartment,
  requireQueryParam,
  requireSetCookieValue,
} from './api-integration.harness';
import {
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTlsDirectory,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  resetApiIntegrationTlsDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

type InvalidateEdgeAppAccessSessions = () => Promise<void>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;
type ResolveDnsRecord = (hostname: string) => Promise<string[]>;
type ResolveTxtRecord = (hostname: string) => Promise<string[][]>;

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
}

interface DnsPromiseMocks {
  resolve4: Mock<ResolveDnsRecord>;
  resolve6: Mock<ResolveDnsRecord>;
  resolveCname: Mock<ResolveDnsRecord>;
  resolveTxt: Mock<ResolveTxtRecord>;
}

const appAccessEdgeServiceMocks: AppAccessEdgeServiceMocks = vi.hoisted(
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: vi.fn<InvalidateEdgeAppAccessSessions>(),
    synchronizeEdgeAppAccessState: vi.fn<SynchronizeEdgeAppAccessState>(),
  }),
);

const dnsPromiseMocks: DnsPromiseMocks = vi.hoisted(
  (): DnsPromiseMocks => ({
    resolve4: vi.fn<ResolveDnsRecord>(),
    resolve6: vi.fn<ResolveDnsRecord>(),
    resolveCname: vi.fn<ResolveDnsRecord>(),
    resolveTxt: vi.fn<ResolveTxtRecord>(),
  }),
);

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions,
    synchronizeEdgeAppAccessState: appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState,
  }),
);

vi.mock(
  'node:dns/promises',
  (): DnsPromiseMocks => ({
    resolve4: dnsPromiseMocks.resolve4,
    resolve6: dnsPromiseMocks.resolve6,
    resolveCname: dnsPromiseMocks.resolveCname,
    resolveTxt: dnsPromiseMocks.resolveTxt,
  }),
);

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testCustomTlsDirectory,
} = createApiIntegrationTestContext(
  'api_integration_organization_user_activation',
  'api-integration-organization-user-activation',
);
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration organization user activation', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockReset();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockReset();
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
    dnsPromiseMocks.resolve4.mockReset();
    dnsPromiseMocks.resolve4.mockResolvedValue(['203.0.113.10']);
    dnsPromiseMocks.resolve6.mockReset();
    dnsPromiseMocks.resolve6.mockRejectedValue(new Error('No AAAA record.'));
    dnsPromiseMocks.resolveCname.mockReset();
    dnsPromiseMocks.resolveCname.mockRejectedValue(new Error('No CNAME record.'));
    dnsPromiseMocks.resolveTxt.mockReset();
    dnsPromiseMocks.resolveTxt.mockRejectedValue(new Error('No TXT record.'));
    await resetApiIntegrationTlsDirectory(testCustomTlsDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });

  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTlsDirectory(testCustomTlsDirectory);
  });

  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });

  it('keeps SSO-only invites pending without returning a local activation link', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createOrganization(installPayload.sessionToken, 'Beta Dev', 'beta-dev');
    const acmeOrganizationId: string = await readOrganizationIdBySlug('acme-dev');
    await configureOrganizationForSsoOnly(acmeOrganizationId);
    const ssoSessionToken: string = await createAdminSsoSession(acmeOrganizationId);

    const invitePayload: InviteUserResponse = await inviteViewer(ssoSessionToken);

    expect(invitePayload.invitation).toBeNull();
    expect(invitePayload.user.status).toBe('invited');
  });

  it('does not report local-password-disabled state for blocked invites', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = await inviteViewer(installPayload.sessionToken);
    const activationToken: string = readActivationToken(invitePayload);
    const blockResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}/block`,
    });
    expect(blockResponse.statusCode).toBe(200);
    await configureOrganizationForSsoOnly(await readOrganizationIdBySlug('acme-dev'));

    const statePayload: ActivateStateResponse = await readActivationState(activationToken, 'viewer@example.com');

    expect(statePayload).not.toHaveProperty('unavailableReason');
    expect(statePayload.hasToken).toBe(true);
  });

  it('rejects local activation when no active organization keeps local password login enabled', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const activationToken: string = readActivationToken(await inviteViewer(installPayload.sessionToken));
    await configureOrganizationForSsoOnly(await readOrganizationIdBySlug('acme-dev'));

    const activationResponse: LightMyRequestResponse = await activateViewer(activationToken);

    expect(activationResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(activationResponse.json()).error.code).toBe('invalid_bootstrap_token');
  });

  it('does not report local-password-disabled state for expired activation tokens', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = await inviteViewer(installPayload.sessionToken);
    const activationToken: string = readActivationToken(invitePayload);
    await db
      .update(localCredentials)
      .set({
        bootstrapTokenExpiresAt: new Date('2000-01-01T00:00:00.000Z'),
      })
      .where(eq(localCredentials.principalId, invitePayload.user.id));
    await configureOrganizationForSsoOnly(await readOrganizationIdBySlug('acme-dev'));

    const statePayload: ActivateStateResponse = await readActivationStateAfterRejectedLanding(
      activationToken,
      'viewer@example.com',
    );

    expect(statePayload).not.toHaveProperty('unavailableReason');
    expect(statePayload.hasToken).toBe(false);
  });

  it('does not use an activation token from one email to force SSO fallback for another', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const activationToken: string = readActivationToken(await inviteViewer(installPayload.sessionToken));
    await configureOrganizationForSsoOnly(await readOrganizationIdBySlug('acme-dev'));

    const statePayload: ActivateStateResponse = await readActivationStateAfterRejectedLanding(
      activationToken,
      'other@example.com',
    );

    expect(statePayload.email).toBe('other@example.com');
    expect(statePayload).not.toHaveProperty('unavailableReason');
    expect(statePayload.hasToken).toBe(false);
  });

  it('rejects activation when the scoped organization disables local passwords even if another organization allows them', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createOrganization(installPayload.sessionToken, 'Beta Dev', 'beta-dev');
    const acmeActivationToken: string = readActivationToken(
      await inviteViewer(installPayload.sessionToken, 'acme-dev'),
    );
    const betaInvitePayload: InviteUserResponse = await inviteViewer(installPayload.sessionToken, 'beta-dev');
    expect(betaInvitePayload.invitation).toBeNull();
    await configureOrganizationForSsoOnly(await readOrganizationIdBySlug('acme-dev'));

    const statePayload: ActivateStateResponse = await readActivationState(acmeActivationToken, 'viewer@example.com');
    expect(statePayload.unavailableReason).toBe('local_password_disabled');

    const activationResponse: LightMyRequestResponse = await activateViewer(acmeActivationToken);
    expect(activationResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(activationResponse.json()).error.code).toBe('invalid_bootstrap_token');
  });
});

async function createOrganization(sessionToken: string, name: string, slug: string): Promise<void> {
  const createOrganizationResponse: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: `Bearer ${sessionToken}`,
    },
    method: 'POST',
    payload: {
      name,
      slug,
    },
    url: '/v1/organizations',
  });
  expect(createOrganizationResponse.statusCode).toBe(200);
  createOrganizationResponseSchema.parse(createOrganizationResponse.json());
}

async function inviteViewer(sessionToken: string, organizationSlug: string = 'acme-dev'): Promise<InviteUserResponse> {
  const inviteResponse: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: `Bearer ${sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: organizationSlug,
    },
    method: 'POST',
    payload: {
      email: 'viewer@example.com',
    },
    url: '/v1/users',
  });
  expect(inviteResponse.statusCode).toBe(200);

  return inviteUserResponseSchema.parse(inviteResponse.json());
}

function readActivationToken(invitePayload: InviteUserResponse): string {
  return requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');
}

async function readActivationState(activationToken: string, email: string): Promise<ActivateStateResponse> {
  const activationFlowCookie: string = await readActivationFlowCookie(activationToken, email);
  return await readActivationStateWithCookie(email, activationFlowCookie);
}

async function readActivationStateAfterRejectedLanding(
  activationToken: string,
  email: string,
): Promise<ActivateStateResponse> {
  const landingResponse: LightMyRequestResponse = await app.inject({
    method: 'GET',
    query: {
      email,
      token: activationToken,
    },
    url: '/activate',
  });
  expect(landingResponse.statusCode).toBe(302);
  expect(String(landingResponse.headers['set-cookie'])).toContain('__Host-compartment_activate_flow=;');
  expect(String(landingResponse.headers['set-cookie'])).toContain('__Host-compartment_activate_token=;');

  return await readActivationStateWithCookie(email);
}

async function readActivationStateWithCookie(
  email: string,
  activationFlowCookie?: string,
): Promise<ActivateStateResponse> {
  const stateResponse: LightMyRequestResponse =
    activationFlowCookie === undefined
      ? await app.inject({
          method: 'GET',
          query: {
            email,
          },
          url: authApiActivateStatePathname,
        })
      : await app.inject({
          headers: {
            cookie: activationFlowCookie,
          },
          method: 'GET',
          query: {
            email,
          },
          url: authApiActivateStatePathname,
        });
  expect(stateResponse.statusCode).toBe(200);

  return activateStateResponseSchema.parse(stateResponse.json());
}

async function readActivationFlowCookie(activationToken: string, email: string): Promise<string> {
  const landingResponse: LightMyRequestResponse = await app.inject({
    method: 'GET',
    query: {
      email,
      token: activationToken,
    },
    url: '/activate',
  });
  expect(landingResponse.statusCode).toBe(302);

  return `__Host-compartment_activate_flow=${requireSetCookieValue(
    landingResponse.headers['set-cookie'],
    '__Host-compartment_activate_flow',
  )}`;
}

async function activateViewer(activationToken: string): Promise<LightMyRequestResponse> {
  return await app.inject({
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    payload: {
      bootstrapToken: activationToken,
      email: 'viewer@example.com',
      password: 'viewersecretpassword',
    },
    url: authApiActivatePathname,
  });
}

async function readOrganizationIdBySlug(organizationSlug: string): Promise<string> {
  const organizationId: string | undefined = (
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, organizationSlug))
      .limit(1)
  )[0]?.id;
  if (organizationId === undefined) {
    throw new Error(`Expected organization ${organizationSlug}.`);
  }
  return organizationId;
}

async function configureOrganizationForSsoOnly(organizationId: string): Promise<void> {
  await db.insert(ssoOidcProviders).values({
    buttonText: 'Continue with Acme SSO',
    clientId: 'oidc-client',
    clientSecretCiphertext: 'ciphertext',
    clientSecretEncryptionKeyId: 'key_123',
    createdAt: new Date(),
    displayName: 'Acme SSO',
    id: `sop_${organizationId}`,
    identityVerificationJson: JSON.stringify(buildDefaultSsoOidcIdentityVerificationConfig()),
    issuerUrl: 'https://issuer.example.com',
    key: `acme-sso-${organizationId}`,
    organizationId,
    preset: 'generic',
    provisioningPolicyJson: JSON.stringify(buildDisabledSsoOidcProvisioningPolicy()),
    scope: 'openid email profile',
    updatedAt: new Date(),
  });
  await db.update(organizations).set({ localPasswordEnabled: false }).where(eq(organizations.id, organizationId));
}

async function createAdminSsoSession(organizationId: string): Promise<string> {
  const adminPrincipalId: string = (
    await db.select({ id: principals.id }).from(principals).where(eq(principals.email, 'admin@example.com')).limit(1)
  )[0]!.id;
  const ssoSessionToken: string = `oidc-session-token-${organizationId}`;

  await db.insert(authSessions).values({
    authMethodKind: 'oidc',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    id: `ses_oidc_${organizationId}`,
    oidcProviderId: `sop_${organizationId}`,
    organizationId,
    principalId: adminPrincipalId,
    tokenHash: hashToken(ssoSessionToken, defaultApiConfig.sessionSecret),
  });

  return ssoSessionToken;
}
