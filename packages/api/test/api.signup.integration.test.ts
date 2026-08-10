import { randomUUID } from 'node:crypto';
import {
  claimAccountResponseSchema,
  compartmentIdempotencyKeyHeaderName,
  compartmentWhoAmIPathname,
  errorResponseSchema,
  listCompartmentRolePermissions,
  loginResponseSchema,
  signupResponseSchema,
  whoamiResponseSchema,
  type ClaimAccountRequest,
  type ClaimAccountResponse,
  type LoginResponse,
  type OrganizationSummary,
  type PermissionKey,
  type SignupRequest,
  type SignupResponse,
  type WhoAmIResponse,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { signupIdempotencyKeys } from '../src/db/schema';
import { hashToken } from '../src/lib/tokens';
import { authApiClaimPathname, authApiLoginPathname, authApiSignupPathname } from '../src/routes/auth/auth-api-paths';
import {
  buildOrganizationAuthorizationHeaders,
  installCompartment,
  rollbackOpenTransaction,
  waitForConcurrentDatabaseWork,
} from './api-integration.harness';
import {
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  resetApiIntegrationTempDirectory,
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
  apiConfig: signupDisabledApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testTempDirectory,
} = createApiIntegrationTestContext('api_integration_signup', 'api-integration-signup');
const signupEnabledApiConfig: ApiConfig = { ...signupDisabledApiConfig, signupEnabled: true };
const claimedPassword: string = 'claimed-password-1';
const expiredSignupKeyAgeMs: number = 90_000_000;
const racingSignupPrincipalId: string = 'prn_race_signup';

let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration CLI self-service signup', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockReset();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockReset();
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
    await resetApiIntegrationTempDirectory(testTempDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(signupEnabledApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(signupEnabledApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });

  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTempDirectory(testTempDirectory);
  });

  afterEach(async (): Promise<void> => {
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });

  it('creates the account with its first organization and returns a session that works', async (): Promise<void> => {
    await installCompartment(app);

    const signup: SignupResponse = await signUp({ email: 'agent@example.com', organizationName: 'Agent Org' });

    expect(signup.principal.email).toBe('agent@example.com');
    expect(signup.organizations.map((organization: OrganizationSummary): string => organization.slug)).toEqual([
      'agent-org',
    ]);
    const identity: WhoAmIResponse = await readWhoAmI(signup.sessionToken, 'agent-org');
    expect(identity.principal.id).toBe(signup.principal.id);
    expect(identity.currentOrganization?.slug).toBe('agent-org');
  });

  it('creates a usable account when the caller omits an email', async (): Promise<void> => {
    await installCompartment(app);

    const signup: SignupResponse = await signUp({ organizationName: 'Unattended Org' });

    expect(signup.principal.email).toBe(`${signup.principal.id}@signup.localhost`);
    const identity: WhoAmIResponse = await readWhoAmI(signup.sessionToken, 'unattended-org');
    expect(identity.principal.email).toBe(signup.principal.email);
  });

  it('keeps generated emails distinct across unattended signups', async (): Promise<void> => {
    await installCompartment(app);

    const first: SignupResponse = await signUp({ organizationName: 'First Org' });
    const second: SignupResponse = await signUp({ organizationName: 'Second Org' });

    expect(first.principal.email).not.toBe(second.principal.email);
    expect(first.principal.id).not.toBe(second.principal.id);
  });

  it('hands the same account and a working session back when a lost signup is retried', async (): Promise<void> => {
    await installCompartment(app);
    const idempotencyKey: string = randomUUID();
    const lost: SignupResponse = await signUp(
      { email: 'agent@example.com', organizationName: 'Agent Org' },
      idempotencyKey,
    );

    const retry: SignupResponse = await signUp(
      { email: 'agent@example.com', organizationName: 'Agent Org' },
      idempotencyKey,
    );

    expect(retry.principal).toEqual(lost.principal);
    expect(retry.organizations).toEqual(lost.organizations);
    expect(retry.sessionToken).not.toBe(lost.sessionToken);
    const identity: WhoAmIResponse = await readWhoAmI(retry.sessionToken, 'agent-org');
    expect(identity.principal.id).toBe(lost.principal.id);
  });

  it('keeps the generated address stable when an unattended signup is retried', async (): Promise<void> => {
    await installCompartment(app);
    const idempotencyKey: string = randomUUID();
    const lost: SignupResponse = await signUp({ organizationName: 'Unattended Org' }, idempotencyKey);

    const retry: SignupResponse = await signUp({ organizationName: 'Unattended Org' }, idempotencyKey);

    expect(retry.principal).toEqual(lost.principal);
    expect(retry.organizations).toEqual(lost.organizations);
  });

  it('joins the account when a concurrent attempt under the same key commits first', async (): Promise<void> => {
    await installCompartment(app);
    const idempotencyKey: string = randomUUID();
    const payload: SignupRequest = { email: 'agent@example.com', organizationName: 'Agent Org' };
    const racingClient: PoolClient = await pool.connect();

    try {
      await stageRacingSignupAccount(racingClient, payload, idempotencyKey);
      const signupPromise: Promise<LightMyRequestResponse> = injectSignup(payload, idempotencyKey);
      await waitForConcurrentDatabaseWork();
      await racingClient.query('COMMIT');

      const response: LightMyRequestResponse = await signupPromise;

      expect(response.statusCode).toBe(200);
      const signup: SignupResponse = signupResponseSchema.parse(response.json());
      expect(signup.principal.id).toBe(racingSignupPrincipalId);
      expect(signup.organizations).toHaveLength(1);
      const identity: WhoAmIResponse = await readWhoAmI(signup.sessionToken, signup.organizations[0]!.slug);
      expect(identity.principal.id).toBe(racingSignupPrincipalId);
    } finally {
      await rollbackOpenTransaction(racingClient);
      racingClient.release();
    }
  });

  it('reports the claimed address when a key is retried after the account was claimed', async (): Promise<void> => {
    await installCompartment(app);
    const idempotencyKey: string = randomUUID();
    const signup: SignupResponse = await signUp({ organizationName: 'Agent Org' }, idempotencyKey);
    await injectClaim(signup.sessionToken, { email: 'owner@example.com', password: claimedPassword });

    const retry: SignupResponse = await signUp({ organizationName: 'Agent Org' }, idempotencyKey);

    expect(retry.principal.id).toBe(signup.principal.id);
    expect(retry.principal.email).toBe('owner@example.com');
  });

  it('refuses a retry that would produce a different account', async (): Promise<void> => {
    await installCompartment(app);
    const idempotencyKey: string = randomUUID();
    const signup: SignupResponse = await signUp(
      { email: 'agent@example.com', organizationName: 'Agent Org' },
      idempotencyKey,
    );

    const renamedOrganization: LightMyRequestResponse = await injectSignup(
      { email: 'agent@example.com', organizationName: 'Other Org' },
      idempotencyKey,
    );
    const otherEmail: LightMyRequestResponse = await injectSignup(
      { email: 'other@example.com', organizationName: 'Agent Org' },
      idempotencyKey,
    );

    expect(renamedOrganization.statusCode).toBe(409);
    expect(errorResponseSchema.parse(renamedOrganization.json()).error.code).toBe('signup_idempotency_conflict');
    expect(otherEmail.statusCode).toBe(409);
    expect(errorResponseSchema.parse(otherEmail.json()).error.code).toBe('signup_idempotency_conflict');
    const identity: WhoAmIResponse = await readWhoAmI(signup.sessionToken, 'agent-org');
    expect(identity.principal.email).toBe('agent@example.com');
  });

  it('stops honouring a key once it is older than the retry window', async (): Promise<void> => {
    await installCompartment(app);
    const idempotencyKey: string = randomUUID();
    await signUp({ email: 'agent@example.com', organizationName: 'Agent Org' }, idempotencyKey);
    await expireStoredSignupIdempotencyKeys();

    const response: LightMyRequestResponse = await injectSignup(
      { email: 'agent@example.com', organizationName: 'Agent Org' },
      idempotencyKey,
    );

    expect(response.statusCode).toBe(409);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('signup_idempotency_key_expired');
  });

  it('refuses a signup that carries no key a retry could reuse', async (): Promise<void> => {
    await installCompartment(app);

    const withoutKey: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: { organizationName: 'Agent Org' },
      url: authApiSignupPathname,
    });
    const guessableKey: LightMyRequestResponse = await injectSignup({ organizationName: 'Agent Org' }, 'agent-signup');

    expect(withoutKey.statusCode).toBe(400);
    expect(errorResponseSchema.parse(withoutKey.json()).error.code).toBe('invalid_signup_idempotency_key');
    expect(guessableKey.statusCode).toBe(400);
    expect(errorResponseSchema.parse(guessableKey.json()).error.code).toBe('invalid_signup_idempotency_key');
  });

  it('frees the requested email again when the organization name collides', async (): Promise<void> => {
    await installCompartment(app);
    await signUp({ email: 'agent@example.com', organizationName: 'Agent Org' });

    const collision: LightMyRequestResponse = await injectSignup({
      email: 'second@example.com',
      organizationName: 'Agent Org',
    });
    expect(collision.statusCode).toBe(409);
    expect(errorResponseSchema.parse(collision.json()).error.code).toBe('organization_slug_taken');

    const retry: SignupResponse = await signUp({ email: 'second@example.com', organizationName: 'Second Org' });
    expect(retry.principal.email).toBe('second@example.com');
  });

  it('rejects a signup for an email that is already registered', async (): Promise<void> => {
    await installCompartment(app);

    const response: LightMyRequestResponse = await injectSignup({
      email: 'admin@example.com',
      organizationName: 'Impostor Org',
    });

    expect(response.statusCode).toBe(409);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('email_taken');
  });

  it('turns an unattended account into one a human can log into', async (): Promise<void> => {
    await installCompartment(app);
    const signup: SignupResponse = await signUp({ organizationName: 'Agent Org' });

    const claimResponse: LightMyRequestResponse = await injectClaim(signup.sessionToken, {
      email: 'owner@example.com',
      password: claimedPassword,
    });
    expect(claimResponse.statusCode).toBe(200);
    const claim: ClaimAccountResponse = claimAccountResponseSchema.parse(claimResponse.json());
    expect(claim.principal.id).toBe(signup.principal.id);
    expect(claim.principal.email).toBe('owner@example.com');

    const login: LoginResponse = await logIn('owner@example.com', claimedPassword);
    expect(login.sessionToken).toBeDefined();
    const identity: WhoAmIResponse = await readWhoAmI(login.sessionToken!, 'agent-org');
    expect(identity.principal.id).toBe(signup.principal.id);
    expect(sortPermissionKeys(identity.currentOrganizationPermissions)).toEqual(
      sortPermissionKeys(listCompartmentRolePermissions('admin')),
    );
  });

  it('refuses a second claim so a leaked session cannot rewrite settled credentials', async (): Promise<void> => {
    await installCompartment(app);
    const signup: SignupResponse = await signUp({ organizationName: 'Agent Org' });
    await injectClaim(signup.sessionToken, { email: 'owner@example.com', password: claimedPassword });

    const response: LightMyRequestResponse = await injectClaim(signup.sessionToken, {
      email: 'attacker@example.com',
      password: 'attacker-password-1',
    });

    expect(response.statusCode).toBe(409);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('account_already_claimed');
    const login: LoginResponse = await logIn('owner@example.com', claimedPassword);
    expect(login.sessionToken).toBeDefined();
  });

  it('rejects an unauthenticated claim outright', async (): Promise<void> => {
    await installCompartment(app);

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: { email: 'owner@example.com', password: claimedPassword },
      url: authApiClaimPathname,
    });

    expect(response.statusCode).toBe(401);
  });

  it('keeps the generated email unusable once the account has been claimed', async (): Promise<void> => {
    await installCompartment(app);
    const signup: SignupResponse = await signUp({ organizationName: 'Agent Org' });
    const generatedEmail: string = signup.principal.email;

    expect(
      (await injectClaim(signup.sessionToken, { email: 'owner@example.com', password: claimedPassword })).statusCode,
    ).toBe(200);

    const loginResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: { email: generatedEmail, password: claimedPassword },
      url: authApiLoginPathname,
    });
    expect(loginResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(loginResponse.json()).error.code).toBe('invalid_credentials');
  });

  it('refuses a claim for an email another account already owns', async (): Promise<void> => {
    await installCompartment(app);
    const signup: SignupResponse = await signUp({ organizationName: 'Agent Org' });

    const response: LightMyRequestResponse = await injectClaim(signup.sessionToken, {
      email: 'admin@example.com',
      password: claimedPassword,
    });

    expect(response.statusCode).toBe(409);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('email_taken');
    const identity: WhoAmIResponse = await readWhoAmI(signup.sessionToken, 'agent-org');
    expect(identity.principal.email).toBe(signup.principal.email);
  });

  it('refuses to sign anyone up while self-service signup stays disabled', async (): Promise<void> => {
    await installCompartment(app);
    configureApiRuntimeWithPublicIngress(signupDisabledApiConfig, db);

    const response: LightMyRequestResponse = await injectSignup({ organizationName: 'Blocked Org' });

    expect(response.statusCode).toBe(403);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('signup_disabled');
  });
});

function sortPermissionKeys(permissionKeys: readonly PermissionKey[]): PermissionKey[] {
  return [...permissionKeys].sort((left: PermissionKey, right: PermissionKey): number => left.localeCompare(right));
}

async function injectSignup(
  payload: SignupRequest,
  idempotencyKey: string = randomUUID(),
): Promise<LightMyRequestResponse> {
  return await app.inject({
    headers: { [compartmentIdempotencyKeyHeaderName]: idempotencyKey },
    method: 'POST',
    payload,
    url: authApiSignupPathname,
  });
}

async function signUp(payload: SignupRequest, idempotencyKey?: string): Promise<SignupResponse> {
  const response: LightMyRequestResponse = await injectSignup(payload, idempotencyKey);
  expect(response.statusCode).toBe(200);

  return signupResponseSchema.parse(response.json());
}

/**
 * Holds an uncommitted account that claimed the same key first, so the request under test blocks on the email index
 * and only learns about the winner once this transaction commits. Two API replicas racing on one key reach exactly
 * this state, and a single in-process pair of requests never does.
 */
async function stageRacingSignupAccount(
  client: PoolClient,
  payload: SignupRequest,
  idempotencyKey: string,
): Promise<void> {
  const sessionSecret: string = signupEnabledApiConfig.sessionSecret;
  await client.query('BEGIN');
  await client.query('insert into principals (id, type, email) values ($1, $2, $3)', [
    racingSignupPrincipalId,
    'user',
    payload.email,
  ]);
  await client.query(
    'insert into signup_idempotency_keys (id, principal_id, key_hash, request_hash) values ($1, $2, $3, $4)',
    [
      'sgnidem_race',
      racingSignupPrincipalId,
      hashToken(idempotencyKey, sessionSecret),
      hashToken(
        JSON.stringify({ email: payload.email ?? null, organizationName: payload.organizationName }),
        sessionSecret,
      ),
    ],
  );
}

/**
 * Ages every stored key just past the retry window the service documents, which is the only way to observe the
 * expiry rule without waiting a day.
 */
async function expireStoredSignupIdempotencyKeys(): Promise<void> {
  await db.update(signupIdempotencyKeys).set({ createdAt: new Date(Date.now() - expiredSignupKeyAgeMs) });
}

async function injectClaim(sessionToken: string, payload: ClaimAccountRequest): Promise<LightMyRequestResponse> {
  return await app.inject({
    headers: { authorization: `Bearer ${sessionToken}` },
    method: 'POST',
    payload,
    url: authApiClaimPathname,
  });
}

async function logIn(email: string, password: string): Promise<LoginResponse> {
  const response: LightMyRequestResponse = await app.inject({
    method: 'POST',
    payload: { email, password },
    url: authApiLoginPathname,
  });
  expect(response.statusCode).toBe(200);

  return loginResponseSchema.parse(response.json());
}

async function readWhoAmI(sessionToken: string, organizationSlug: string): Promise<WhoAmIResponse> {
  const response: LightMyRequestResponse = await app.inject({
    headers: buildOrganizationAuthorizationHeaders(sessionToken, organizationSlug),
    method: 'GET',
    url: compartmentWhoAmIPathname,
  });
  expect(response.statusCode).toBe(200);

  return whoamiResponseSchema.parse(response.json());
}
