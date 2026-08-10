import {
  claimAccountResponseSchema,
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
  type SignupRequest,
  type SignupResponse,
  type WhoAmIResponse,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiApp } from '../src/app.types';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { authApiClaimPathname, authApiLoginPathname, authApiSignupPathname } from '../src/routes/auth/auth-api-paths';
import { buildOrganizationAuthorizationHeaders, installCompartment } from './api-integration.harness';
import {
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  resetApiIntegrationTempDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

const {
  apiConfig: signupDisabledApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testTempDirectory,
} = createApiIntegrationTestContext('api_integration_signup', 'api-integration-signup');
const signupEnabledApiConfig: ApiConfig = { ...signupDisabledApiConfig, signupEnabled: true };
const claimedPassword: string = 'claimed-password-1';

let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration CLI self-service signup', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
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
    expect(identity.currentOrganizationPermissions).toEqual(listCompartmentRolePermissions('admin'));
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

async function injectSignup(payload: SignupRequest): Promise<LightMyRequestResponse> {
  return await app.inject({
    method: 'POST',
    payload,
    url: authApiSignupPathname,
  });
}

async function signUp(payload: SignupRequest): Promise<SignupResponse> {
  const response: LightMyRequestResponse = await injectSignup(payload);
  expect(response.statusCode).toBe(200);

  return signupResponseSchema.parse(response.json());
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
