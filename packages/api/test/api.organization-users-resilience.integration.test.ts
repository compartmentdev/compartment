import {
  compartmentCurrentOrganizationHeaderName,
  errorResponseSchema,
  inviteUserResponseSchema,
  type InstallResponse,
  type InviteUserResponse,
  type OrganizationUserSummary,
  type UserListResponse,
  userListResponseSchema,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { count, eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { authSessions } from '../src/db/schema';
import { createEdgeStateUpdateFailedError } from '../src/errors/api-business-error';
import { authApiActivatePathname } from '../src/routes/auth/auth-api-paths';
import {
  buildOrganizationAuthorizationHeaders,
  installCompartment,
  requireQueryParam,
  rollbackOpenTransaction,
  waitForConcurrentDatabaseWork,
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

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
}

const appAccessEdgeServiceMocks: AppAccessEdgeServiceMocks = vi.hoisted(
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: vi.fn<InvalidateEdgeAppAccessSessions>(),
    synchronizeEdgeAppAccessState: vi.fn<SynchronizeEdgeAppAccessState>(),
  }),
);

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions,
    synchronizeEdgeAppAccessState: appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState,
  }),
);

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testCustomTlsDirectory,
} = createApiIntegrationTestContext(
  'api_integration_organization_users_resilience',
  'api-integration-organization-users-resilience',
);
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration organization user resilience', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockReset();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockReset();
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
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

  it('returns edge sync failures after invite while keeping the committed membership', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(createEdgeStateUpdateFailedError());

    const inviteResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      payload: {
        email: 'viewer@example.com',
      },
      url: '/v1/users',
    });
    expect(inviteResponse.statusCode).toBe(502);
    expect(errorResponseSchema.parse(inviteResponse.json()).error.code).toBe('edge_state_update_failed');

    const listPayload: UserListResponse = await listOrganizationUsers(installPayload.sessionToken);
    const invitedUser: OrganizationUserSummary | undefined = listPayload.users.find(
      (user: OrganizationUserSummary): boolean => user.email === 'viewer@example.com',
    );
    expect(invitedUser?.roleNames).toEqual([]);
    expect(invitedUser?.status).toBe('invited');
  });

  it('returns edge sync failures after removals while keeping the membership deletion committed', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await inviteOrganizationUser(installPayload.sessionToken);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockRejectedValueOnce(createEdgeStateUpdateFailedError());

    const removeResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `/v1/users/${encodeURIComponent('viewer@example.com')}`,
    });
    expect(removeResponse.statusCode).toBe(502);
    expect(errorResponseSchema.parse(removeResponse.json()).error.code).toBe('edge_state_update_failed');

    const listPayload: UserListResponse = await listOrganizationUsers(installPayload.sessionToken);
    expect(
      listPayload.users.find((user: OrganizationUserSummary): boolean => user.email === 'viewer@example.com'),
    ).toBe(undefined);
  });

  it('maps invite races to organization user conflicts instead of server errors', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const principalInsertClient: PoolClient = await pool.connect();

    try {
      await principalInsertClient.query('BEGIN');
      await principalInsertClient.query('insert into principals (id, type, email) values ($1, $2, $3)', [
        'prn_race_invite',
        'user',
        'Viewer@Example.com',
      ]);

      const inviteResponsePromise: Promise<LightMyRequestResponse> = inviteOrganizationUser(
        installPayload.sessionToken,
      );
      await waitForConcurrentDatabaseWork();
      await principalInsertClient.query('COMMIT');

      const inviteResponse: LightMyRequestResponse = await inviteResponsePromise;

      expect(inviteResponse.statusCode).toBe(409);
      expect(errorResponseSchema.parse(inviteResponse.json()).error.code).toBe('organization_user_exists');
    } finally {
      await rollbackOpenTransaction(principalInsertClient);
      principalInsertClient.release();
    }
  });

  it('consumes each invitation token at most once under concurrent activation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitePayload: InviteUserResponse = inviteUserResponseSchema.parse(
      (await inviteOrganizationUser(installPayload.sessionToken)).json(),
    );
    const activationUrl: URL = new URL(invitePayload.invitation?.activationUrl ?? '');
    const credentialsLockClient: PoolClient = await pool.connect();

    try {
      await credentialsLockClient.query('BEGIN');
      await credentialsLockClient.query(
        'select principal_id from local_credentials where principal_id = $1 for update',
        [invitePayload.user.id],
      );

      const firstActivationPromise: Promise<LightMyRequestResponse> = activateViewer(activationUrl);
      const secondActivationPromise: Promise<LightMyRequestResponse> = activateViewer(activationUrl);

      await waitForConcurrentDatabaseWork();
      await credentialsLockClient.query('COMMIT');

      const activationResponses: [LightMyRequestResponse, LightMyRequestResponse] = await Promise.all([
        firstActivationPromise,
        secondActivationPromise,
      ]);
      const statusCodes: number[] = activationResponses
        .map((response: LightMyRequestResponse): number => response.statusCode)
        .sort((left: number, right: number): number => left - right);
      const failedActivation: LightMyRequestResponse | undefined = activationResponses.find(
        (response: LightMyRequestResponse): boolean => response.statusCode === 401,
      );
      const storedViewerSessions: { value: number }[] = await db
        .select({ value: count() })
        .from(authSessions)
        .where(eq(authSessions.principalId, invitePayload.user.id));

      expect(statusCodes).toEqual([200, 401]);
      expect(failedActivation).toBeDefined();
      expect(errorResponseSchema.parse(failedActivation?.json()).error.code).toBe('invalid_bootstrap_token');
      expect(storedViewerSessions[0]?.value).toBe(1);
    } finally {
      await rollbackOpenTransaction(credentialsLockClient);
      credentialsLockClient.release();
    }
  });
});

async function activateViewer(activationUrl: URL): Promise<LightMyRequestResponse> {
  return await app.inject({
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    payload: {
      bootstrapToken: requireQueryParam(activationUrl, 'token'),
      email: 'viewer@example.com',
      password: 'viewersecretpassword',
    },
    url: authApiActivatePathname,
  });
}

async function inviteOrganizationUser(sessionToken: string): Promise<LightMyRequestResponse> {
  return await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
    method: 'POST',
    payload: {
      email: 'viewer@example.com',
    },
    url: '/v1/users',
  });
}

async function listOrganizationUsers(sessionToken: string): Promise<UserListResponse> {
  const listResponse: LightMyRequestResponse = await app.inject({
    headers: {
      ...buildOrganizationAuthorizationHeaders(sessionToken),
      [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
    },
    method: 'GET',
    url: '/v1/users',
  });
  expect(listResponse.statusCode).toBe(200);

  return userListResponseSchema.parse(listResponse.json());
}
