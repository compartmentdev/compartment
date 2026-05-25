import {
  activateResponseSchema,
  compartmentSessionCookieName,
  errorResponseSchema,
  createOrganizationResponseSchema,
  loginResponseSchema,
  removeUserResponseSchema,
  inviteUserResponseSchema,
  type ActivateResponse,
  type CreateOrganizationResponse,
  type InviteUserResponse,
  type InstallResponse,
  type LoginResponse,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { count, eq } from 'drizzle-orm';
import {
  createStoredAppAccessSession as createStoredAppAccessSessionFixture,
  createStoredSsoOidcProvider as createStoredSsoOidcProviderFixture,
  readStoredAppAccessSession as readStoredAppAccessSessionFixture,
  readStoredAuthSession as readStoredAuthSessionFixture,
  readStoredAuthSessionIdByToken as readStoredAuthSessionIdByTokenFixture,
} from './api-auth-session-test.fixtures';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import {
  authSessions,
  localCredentials,
  operations,
  organizationMemberships,
  ssoOidcIdentities,
} from '../src/db/schema';
import { authApiActivatePathname, authApiLoginPathname } from '../src/routes/auth/auth-api-paths';

import {
  buildSystemAuthorizationHeaders,
  buildOrganizationAuthorizationHeaders,
  installCompartment,
  requireQueryParam,
  rollbackOpenTransaction,
  waitForConcurrentDatabaseWork,
} from './api-integration.harness';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTlsDirectory,
  configureApiRuntimeWithPublicIngress,
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

const blockBootstrapClearLockKey: number = 184_184;
const blockBootstrapClearFunctionName: string = 'block_clear_bootstrap_token_test_fn';
const blockBootstrapClearTriggerName: string = 'block_clear_bootstrap_token_test';

async function installBootstrapClearBlocker(): Promise<void> {
  await removeBootstrapClearBlocker();
  await pool.query(`
    create or replace function ${blockBootstrapClearFunctionName}()
    returns trigger
    language plpgsql
    as $function$
    begin
      perform pg_advisory_lock(${blockBootstrapClearLockKey});
      perform pg_advisory_unlock(${blockBootstrapClearLockKey});
      return new;
    end;
    $function$;
  `);
  await pool.query(`
    create trigger ${blockBootstrapClearTriggerName}
    before update on local_credentials
    for each row
    when (new.bootstrap_token_hash is null and old.bootstrap_token_hash is not null)
    execute function ${blockBootstrapClearFunctionName}();
  `);
}

async function removeBootstrapClearBlocker(): Promise<void> {
  await pool.query(`drop trigger if exists ${blockBootstrapClearTriggerName} on local_credentials`);
  await pool.query(`drop function if exists ${blockBootstrapClearFunctionName}()`);
}

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testCustomTlsDirectory,
} = createApiIntegrationTestContext('api_integration_membership_concurrency', 'api-integration-membership-concurrency');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration membership concurrency', (): void => {
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
  it('rejects activation for removed invited users, clears pending bootstrap state, and avoids orphan sessions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const activationToken: string = requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');

    const removeResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
    });
    expect(removeResponse.statusCode).toBe(200);

    const credentialRows: {
      bootstrapTokenExpiresAt: Date | null;
      bootstrapTokenHash: string | null;
    }[] = await db
      .select({
        bootstrapTokenExpiresAt: localCredentials.bootstrapTokenExpiresAt,
        bootstrapTokenHash: localCredentials.bootstrapTokenHash,
      })
      .from(localCredentials)
      .where(eq(localCredentials.principalId, invitePayload.user.id));

    expect(credentialRows[0]).toEqual({
      bootstrapTokenExpiresAt: null,
      bootstrapTokenHash: null,
    });

    const activationResponse: LightMyRequestResponse = await app.inject({
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
    const storedViewerSessions: { value: number }[] = await db
      .select({ value: count() })
      .from(authSessions)
      .where(eq(authSessions.principalId, invitePayload.user.id));

    expect(activationResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(activationResponse.json()).error.code).toBe('invalid_bootstrap_token');
    expect(storedViewerSessions[0]?.value).toBe(0);
  });
  it('purges live auth state for active users removed from their last organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createStoredSsoOidcProvider('sop_remove_user', installPayload.organization.id);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const activationToken: string = requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');
    const activationResponse: LightMyRequestResponse = await app.inject({
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
    expect(activationResponse.statusCode).toBe(200);
    const activationPayload: ActivateResponse = activateResponseSchema.parse(activationResponse.json());
    const viewerSessionToken: string = activationPayload.sessionToken ?? '';
    expect(viewerSessionToken).toBeTruthy();
    const viewerSessionId: string = await readStoredAuthSessionIdByToken(viewerSessionToken);

    await createStoredAppAccessSession('aps_removed_viewer', viewerSessionId);
    await db.insert(ssoOidcIdentities).values({
      id: 'soi_removed_viewer',
      lastLoginAt: new Date('2026-04-21T10:00:00.000Z'),
      principalId: invitePayload.user.id,
      providerId: 'sop_remove_user',
      subject: 'subject_removed_viewer',
    });
    const resetIssueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    expect(resetIssueResponse.statusCode).toBe(200);

    const activeWhoAmIResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${viewerSessionToken}`,
      },
      method: 'GET',
      url: '/v1/whoami',
    });
    expect(activeWhoAmIResponse.statusCode).toBe(200);

    const removeResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
    });
    expect(removeResponse.statusCode).toBe(200);
    expect(removeUserResponseSchema.parse(removeResponse.json())).toEqual({ success: true });

    const credentialRows: {
      bootstrapTokenExpiresAt: Date | null;
      bootstrapTokenHash: string | null;
      passwordHash: string | null;
      passwordResetOrganizationId: string | null;
      passwordResetTokenExpiresAt: Date | null;
      passwordResetTokenHash: string | null;
    }[] = await db
      .select({
        bootstrapTokenExpiresAt: localCredentials.bootstrapTokenExpiresAt,
        bootstrapTokenHash: localCredentials.bootstrapTokenHash,
        passwordHash: localCredentials.passwordHash,
        passwordResetOrganizationId: localCredentials.passwordResetOrganizationId,
        passwordResetTokenExpiresAt: localCredentials.passwordResetTokenExpiresAt,
        passwordResetTokenHash: localCredentials.passwordResetTokenHash,
      })
      .from(localCredentials)
      .where(eq(localCredentials.principalId, invitePayload.user.id));
    const identityRows: { id: string }[] = await db
      .select({ id: ssoOidcIdentities.id })
      .from(ssoOidcIdentities)
      .where(eq(ssoOidcIdentities.principalId, invitePayload.user.id));
    const membershipRows: { id: string }[] = await db
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.principalId, invitePayload.user.id));
    const operationRows: { type: string }[] = await db
      .select({ type: operations.type })
      .from(operations)
      .where(eq(operations.targetId, invitePayload.user.id));
    const operationTypes: string[] = operationRows
      .map((row: { type: string }): string => row.type)
      .sort((left: string, right: string): number => left.localeCompare(right));

    expect((await readStoredAuthSession(viewerSessionId)).revokedAt).not.toBeNull();
    expect((await readStoredAppAccessSession('aps_removed_viewer')).revokedAt).not.toBeNull();
    expect(appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions).toHaveBeenCalledWith(viewerSessionId);
    expect(credentialRows[0]).toEqual({
      bootstrapTokenExpiresAt: null,
      bootstrapTokenHash: null,
      passwordHash: null,
      passwordResetOrganizationId: null,
      passwordResetTokenExpiresAt: null,
      passwordResetTokenHash: null,
    });
    expect(identityRows).toHaveLength(0);
    expect(membershipRows).toHaveLength(0);
    expect(operationTypes).toEqual(
      expect.arrayContaining([
        'auth.activate',
        'auth.password_reset.issue',
        'organization.user.invite',
        'organization.user.remove',
      ]),
    );

    const staleApiSessionResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${viewerSessionToken}`,
      },
      method: 'GET',
      url: '/v1/whoami',
    });
    const staleBrowserSessionResponse: LightMyRequestResponse = await app.inject({
      headers: {
        cookie: `${compartmentSessionCookieName}=${viewerSessionToken}`,
      },
      method: 'GET',
      url: '/v1/whoami',
    });
    expect(staleApiSessionResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(staleApiSessionResponse.json()).error.code).toBe('unauthorized');
    expect(staleBrowserSessionResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(staleBrowserSessionResponse.json()).error.code).toBe('unauthorized');

    const reinviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
      },
      url: '/v1/users',
    });
    expect(reinviteResponse.statusCode).toBe(200);
    const reinvitePayload: InviteUserResponse = inviteUserResponseSchema.parse(reinviteResponse.json());
    expect(reinvitePayload.user).toMatchObject({
      email: 'viewer@example.com',
      id: invitePayload.user.id,
      roleNames: [],
      status: 'invited',
    });
    expect(reinvitePayload.invitation).toBeNull();
  });
  it('keeps a concurrent existing-principal re-invite pending until last-membership removal finishes', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const createOrganizationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
      url: '/v1/organizations',
    });
    const betaOrganization: CreateOrganizationResponse = createOrganizationResponseSchema.parse(
      createOrganizationResponse.json(),
    );
    inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const bootstrapClearLockClient: PoolClient = await pool.connect();

    try {
      await installBootstrapClearBlocker();
      await bootstrapClearLockClient.query('select pg_advisory_lock($1)', [blockBootstrapClearLockKey]);

      const removeUserPromise: Promise<LightMyRequestResponse> = app.inject({
        headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
        method: 'DELETE',
        url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
      });

      await waitForConcurrentDatabaseWork();

      let betaInviteCompleted: boolean = false;
      const betaInvitePromise: Promise<LightMyRequestResponse> = app
        .inject({
          headers: buildOrganizationAuthorizationHeaders(
            installPayload.sessionToken,
            betaOrganization.organization.slug,
          ),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
        .then((response: LightMyRequestResponse): LightMyRequestResponse => {
          betaInviteCompleted = true;
          return response;
        });

      await waitForConcurrentDatabaseWork();
      expect(betaInviteCompleted).toBe(false);

      await bootstrapClearLockClient.query('select pg_advisory_unlock($1)', [blockBootstrapClearLockKey]);

      const removeUserResponse: LightMyRequestResponse = await removeUserPromise;
      const betaInviteResponse: LightMyRequestResponse = await betaInvitePromise;
      const betaInvitePayload: InviteUserResponse = inviteUserResponseSchema.parse(betaInviteResponse.json());

      expect(removeUserResponse.statusCode).toBe(200);
      expect(betaInviteResponse.statusCode).toBe(200);
      expect(betaInvitePayload.invitation).toBeNull();
      expect(betaInvitePayload.user).toMatchObject({
        email: 'viewer@example.com',
        roleNames: [],
        status: 'invited',
      });
    } finally {
      await bootstrapClearLockClient.query('select pg_advisory_unlock($1)', [blockBootstrapClearLockKey]);
      bootstrapClearLockClient.release();
      await removeBootstrapClearBlocker();
    }
  });
  it('keeps another organization membership pending without activating a removed-organization invite', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const createOrganizationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
      url: '/v1/organizations',
    });
    const betaOrganization: CreateOrganizationResponse = createOrganizationResponseSchema.parse(
      createOrganizationResponse.json(),
    );

    const firstInvitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const secondInvitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(
            installPayload.sessionToken,
            betaOrganization.organization.slug,
          ),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    await createStoredSsoOidcProvider('sop_removed_acme', installPayload.organization.id);
    await createStoredSsoOidcProvider('sop_kept_beta', betaOrganization.organization.id);
    await db.insert(ssoOidcIdentities).values([
      {
        id: 'soi_removed_acme',
        lastLoginAt: new Date('2026-04-21T10:00:00.000Z'),
        principalId: secondInvitePayload.user.id,
        providerId: 'sop_removed_acme',
        subject: 'subject_removed_acme',
      },
      {
        id: 'soi_kept_beta',
        lastLoginAt: new Date('2026-04-21T10:00:00.000Z'),
        principalId: secondInvitePayload.user.id,
        providerId: 'sop_kept_beta',
        subject: 'subject_kept_beta',
      },
    ]);
    const removedOrganizationActivationToken: string = requireQueryParam(
      new URL(firstInvitePayload.invitation?.activationUrl ?? ''),
      'token',
    );

    const removeResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
    });
    expect(removeResponse.statusCode).toBe(200);

    const credentialRows: {
      bootstrapTokenExpiresAt: Date | null;
      bootstrapTokenHash: string | null;
    }[] = await db
      .select({
        bootstrapTokenExpiresAt: localCredentials.bootstrapTokenExpiresAt,
        bootstrapTokenHash: localCredentials.bootstrapTokenHash,
      })
      .from(localCredentials)
      .where(eq(localCredentials.principalId, secondInvitePayload.user.id));

    const membershipRows: { organizationId: string }[] = await db
      .select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships)
      .where(eq(organizationMemberships.principalId, secondInvitePayload.user.id));
    const identityRows: { id: string }[] = await db
      .select({ id: ssoOidcIdentities.id })
      .from(ssoOidcIdentities)
      .where(eq(ssoOidcIdentities.principalId, secondInvitePayload.user.id));
    const identityIds: string[] = identityRows
      .map((row: { id: string }): string => row.id)
      .sort((left: string, right: string): number => left.localeCompare(right));

    expect(credentialRows[0]?.bootstrapTokenExpiresAt).toBeInstanceOf(Date);
    expect(credentialRows[0]?.bootstrapTokenHash).toBeTruthy();
    expect(membershipRows).toEqual([{ organizationId: betaOrganization.organization.id }]);
    expect(identityIds).toEqual(['soi_kept_beta']);
    expect(secondInvitePayload.invitation).toBeNull();

    const activationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      payload: {
        bootstrapToken: removedOrganizationActivationToken,
        email: 'viewer@example.com',
        password: 'viewersecretpassword',
      },
      url: authApiActivatePathname,
    });

    expect(activationResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(activationResponse.json()).error.code).toBe('invalid_bootstrap_token');
  });
  it('serializes password login while last-membership removal purges live auth state', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const activationToken: string = requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');
    const activationResponse: LightMyRequestResponse = await app.inject({
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
    expect(activationResponse.statusCode).toBe(200);
    const activationPayload: ActivateResponse = activateResponseSchema.parse(activationResponse.json());
    const activationSessionId: string = await readStoredAuthSessionIdByToken(activationPayload.sessionToken ?? '');
    const authSessionLockClient: PoolClient = await pool.connect();

    try {
      await authSessionLockClient.query('BEGIN');
      await authSessionLockClient.query('lock table auth_sessions in share mode');

      let loginCompleted: boolean = false;
      const loginPromise: Promise<LightMyRequestResponse> = app
        .inject({
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
            password: 'viewersecretpassword',
          },
          url: authApiLoginPathname,
        })
        .then((response: LightMyRequestResponse): LightMyRequestResponse => {
          loginCompleted = true;
          return response;
        });

      await waitForConcurrentDatabaseWork();
      expect(loginCompleted).toBe(false);

      let removeCompleted: boolean = false;
      const removeUserPromise: Promise<LightMyRequestResponse> = app
        .inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'DELETE',
          url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
        })
        .then((response: LightMyRequestResponse): LightMyRequestResponse => {
          removeCompleted = true;
          return response;
        });

      await waitForConcurrentDatabaseWork();
      expect(removeCompleted).toBe(false);

      await authSessionLockClient.query('COMMIT');

      const loginResponse: LightMyRequestResponse = await loginPromise;
      const removeUserResponse: LightMyRequestResponse = await removeUserPromise;

      expect(loginResponse.statusCode).toBe(200);
      expect(removeUserResponse.statusCode).toBe(200);

      const loginPayload: LoginResponse = loginResponseSchema.parse(loginResponse.json());
      const loginSessionId: string = await readStoredAuthSessionIdByToken(loginPayload.sessionToken ?? '');

      expect((await readStoredAuthSession(activationSessionId)).revokedAt).not.toBeNull();
      expect((await readStoredAuthSession(loginSessionId)).revokedAt).not.toBeNull();
    } finally {
      await rollbackOpenTransaction(authSessionLockClient);
      authSessionLockClient.release();
    }
  });
  it('keeps last-membership removal pending for mixed-case activation email while session persistence is blocked', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'POST',
          payload: {
            email: 'viewer@example.com',
          },
          url: '/v1/users',
        })
      ).json(),
    );
    const activationToken: string = requireQueryParam(new URL(invitePayload.invitation?.activationUrl ?? ''), 'token');
    const authSessionLockClient: PoolClient = await pool.connect();

    try {
      await authSessionLockClient.query('BEGIN');
      await authSessionLockClient.query('lock table auth_sessions in share mode');

      const activationPromise: Promise<LightMyRequestResponse> = app.inject({
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        payload: {
          bootstrapToken: activationToken,
          email: 'Viewer@Example.com',
          password: 'viewersecretpassword',
        },
        url: authApiActivatePathname,
      });

      await waitForConcurrentDatabaseWork();

      let removeCompleted: boolean = false;
      const removeUserPromise: Promise<LightMyRequestResponse> = app
        .inject({
          headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
          method: 'DELETE',
          url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
        })
        .then((response: LightMyRequestResponse): LightMyRequestResponse => {
          removeCompleted = true;
          return response;
        });

      await waitForConcurrentDatabaseWork();
      expect(removeCompleted).toBe(false);

      await authSessionLockClient.query('COMMIT');

      const activationResponse: LightMyRequestResponse = await activationPromise;
      const removeUserResponse: LightMyRequestResponse = await removeUserPromise;
      const activationPayload: ActivateResponse = activateResponseSchema.parse(activationResponse.json());
      const storedViewerSessions: { value: number }[] = await db
        .select({ value: count() })
        .from(authSessions)
        .where(eq(authSessions.principalId, invitePayload.user.id));

      expect(activationResponse.statusCode).toBe(200);
      expect(removeUserResponse.statusCode).toBe(200);
      expect(activationPayload.organizations).toHaveLength(1);
      expect(storedViewerSessions[0]?.value).toBe(1);
    } finally {
      await rollbackOpenTransaction(authSessionLockClient);
      authSessionLockClient.release();
    }
  });
});

async function createStoredSsoOidcProvider(providerId: string, organizationId: string): Promise<void> {
  await createStoredSsoOidcProviderFixture({
    db,
    organizationId,
    providerId,
    variablesMasterKey: defaultApiConfig.variablesMasterKey,
  });
}

async function createStoredAppAccessSession(appSessionId: string, authSessionId: string): Promise<void> {
  await createStoredAppAccessSessionFixture(db, defaultApiConfig.sessionSecret, appSessionId, authSessionId);
}

async function readStoredAuthSessionIdByToken(sessionToken: string): Promise<string> {
  return await readStoredAuthSessionIdByTokenFixture(db, sessionToken, defaultApiConfig.sessionSecret);
}

async function readStoredAuthSession(sessionId: string): Promise<{ revokedAt: Date | null }> {
  return await readStoredAuthSessionFixture(db, sessionId);
}

async function readStoredAppAccessSession(appSessionId: string): Promise<{ revokedAt: Date | null }> {
  return await readStoredAppAccessSessionFixture(db, appSessionId);
}
