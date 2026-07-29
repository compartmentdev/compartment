import {
  compartmentCurrentOrganizationHeaderName,
  errorResponseSchema,
  issuePasswordResetResponseSchema,
  resetPasswordResponseSchema,
  type InstallResponse,
  type IssuePasswordResetResponse,
  type OrganizationSummary,
  type ResetPasswordResponse,
} from '@compartment/contracts';
import argon2 from 'argon2';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { authSessions, localCredentials, organizationMemberships, organizations, principals } from '../src/db/schema';
import { createToken, hashToken } from '../src/lib/tokens';
import { authApiActivatePathname } from '../src/routes/auth/auth-api-paths';
import { createOrganizationScopedToken } from '../src/services/scoped-token.service.helpers';
import { buildSystemAuthorizationHeaders, installCompartment } from './api-integration.harness';
import {
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  resetApiIntegrationTempDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

interface PasswordResetCredentialFields {
  passwordResetOrganizationId: string | null;
  passwordResetTokenExpiresAt: Date | null;
  passwordResetTokenHash: string | null;
}

interface PendingCredentialFields {
  bootstrapTokenExpiresAt: Date | null;
  bootstrapTokenHash: string | null;
  passwordHash: string | null;
}

interface StoredAuthSessionOrganizationFields {
  authMethodKind: string;
  organizationId: string | null;
}

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
  testTempDirectory,
} = createApiIntegrationTestContext('api_integration_auth_cross_org_security', 'api-integration-auth-cross-org');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration cross-org auth security', (): void => {
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
    await resetApiIntegrationTempDirectory(testTempDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
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

  it('rejects legacy organization-scoped password reset tokens even when their hash matches', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const adminPrincipalId: string = await readPrincipalIdByEmail('admin@example.com');
    const legacyResetToken: string = createOrganizationScopedToken(installPayload.organization.id);

    await db
      .update(localCredentials)
      .set({
        passwordResetTokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
        passwordResetTokenHash: await argon2.hash(legacyResetToken),
      })
      .where(eq(localCredentials.principalId, adminPrincipalId));
    const legacyCredentialFields: PasswordResetCredentialFields =
      await readPasswordResetCredentialFields(adminPrincipalId);

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: ['legacy', 'reset', 'credential'].join('-'),
        resetToken: legacyResetToken,
      },
      url: '/v1/auth/reset-password',
    });

    expect(response.statusCode).toBe(401);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('invalid_password_reset_token');
    await expect(readPasswordResetCredentialFields(adminPrincipalId)).resolves.toEqual(legacyCredentialFields);
  });

  it('completes single-organization system password resets with an organization-scoped session', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const issueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    expect(issueResponse.statusCode).toBe(200);
    const issuePayload: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse(issueResponse.json());

    const resetResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: ['system', 'reset', 'credential'].join('-'),
        resetToken: issuePayload.resetToken,
      },
      url: '/v1/auth/reset-password',
    });

    expect(resetResponse.statusCode).toBe(200);
    const resetPayload: ResetPasswordResponse = resetPasswordResponseSchema.parse(resetResponse.json());
    expect(resetPayload.organizations.map((organization: OrganizationSummary): string => organization.slug)).toEqual([
      'acme-dev',
    ]);
    const resetSessionToken: string = requireResponseSessionToken(resetPayload);
    await expect(readStoredAuthSessionOrganizationFields(resetSessionToken)).resolves.toEqual({
      authMethodKind: 'password_scoped',
      organizationId: installPayload.organization.id,
    });
  });

  it('completes system password reset in its issued organization after the principal gains another organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const adminPrincipalId: string = await readPrincipalIdByEmail('admin@example.com');
    const issueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    expect(issueResponse.statusCode).toBe(200);
    const issuePayload: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse(issueResponse.json());
    await insertOrganization('org_beta_dev', 'Beta Dev', 'beta-dev');
    await insertOrganizationMembership('mem_admin_beta_dev', 'org_beta_dev', adminPrincipalId);

    const resetResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: ['expanded', 'reset', 'credential'].join('-'),
        resetToken: issuePayload.resetToken,
      },
      url: '/v1/auth/reset-password',
    });

    expect(resetResponse.statusCode).toBe(200);
    const resetPayload: ResetPasswordResponse = resetPasswordResponseSchema.parse(resetResponse.json());
    expect(resetPayload.organizations.map((organization: OrganizationSummary): string => organization.slug)).toEqual([
      'acme-dev',
    ]);
    const resetSessionToken: string = requireResponseSessionToken(resetPayload);
    await expect(readStoredAuthSessionOrganizationFields(resetSessionToken)).resolves.toEqual({
      authMethodKind: 'password_scoped',
      organizationId: installPayload.organization.id,
    });
    await expectSessionCannotUseOrganization(resetSessionToken, 'beta-dev');
  });

  it('does not issue system password resets for principals with more than one organization', async (): Promise<void> => {
    await installCompartment(app);
    const adminPrincipalId: string = await readPrincipalIdByEmail('admin@example.com');
    await insertOrganization('org_beta_dev', 'Beta Dev', 'beta-dev');
    await insertOrganizationMembership('mem_admin_beta_dev', 'org_beta_dev', adminPrincipalId);
    const credentialFieldsBeforeIssue: PasswordResetCredentialFields =
      await readPasswordResetCredentialFields(adminPrincipalId);

    const response: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });

    expect(response.statusCode).toBe(409);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('password_reset_not_available');
    await expect(readPasswordResetCredentialFields(adminPrincipalId)).resolves.toEqual(credentialFieldsBeforeIssue);
  });

  it('rejects system reset completion when the issued organization is removed before completion', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const adminPrincipalId: string = await readPrincipalIdByEmail('admin@example.com');
    const issueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    expect(issueResponse.statusCode).toBe(200);
    const issuePayload: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse(issueResponse.json());
    await insertOrganization('org_beta_dev', 'Beta Dev', 'beta-dev');
    await insertOrganizationMembership('mem_admin_beta_dev', 'org_beta_dev', adminPrincipalId);
    await deleteOrganizationMembership(installPayload.organization.id, adminPrincipalId);
    const issuedCredentialFields: PasswordResetCredentialFields =
      await readPasswordResetCredentialFields(adminPrincipalId);

    const resetResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: ['removed', 'organization', 'credential'].join('-'),
        resetToken: issuePayload.resetToken,
      },
      url: '/v1/auth/reset-password',
    });

    expect(resetResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(resetResponse.json()).error.code).toBe('invalid_password_reset_token');
    await expect(readPasswordResetCredentialFields(adminPrincipalId)).resolves.toEqual(issuedCredentialFields);
  });

  it('rejects system reset issue and completion when local password is disabled for the reset organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const adminPrincipalId: string = await readPrincipalIdByEmail('admin@example.com');
    const issueResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });
    expect(issueResponse.statusCode).toBe(200);
    const issuePayload: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse(issueResponse.json());
    await updateOrganizationLocalPasswordEnabled(installPayload.organization.id, false);
    const issuedCredentialFields: PasswordResetCredentialFields =
      await readPasswordResetCredentialFields(adminPrincipalId);

    const resetResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'admin@example.com',
        password: ['disabled', 'organization', 'credential'].join('-'),
        resetToken: issuePayload.resetToken,
      },
      url: '/v1/auth/reset-password',
    });
    expect(resetResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(resetResponse.json()).error.code).toBe('invalid_password_reset_token');
    await expect(readPasswordResetCredentialFields(adminPrincipalId)).resolves.toEqual(issuedCredentialFields);

    await db
      .update(localCredentials)
      .set({
        passwordResetOrganizationId: null,
        passwordResetTokenExpiresAt: null,
        passwordResetTokenHash: null,
      })
      .where(eq(localCredentials.principalId, adminPrincipalId));
    const issueAfterDisableResponse: LightMyRequestResponse = await systemApp.inject({
      headers: buildSystemAuthorizationHeaders(),
      method: 'POST',
      payload: {
        email: 'admin@example.com',
      },
      url: '/internal/system/auth/password-reset/issue',
    });

    expect(issueAfterDisableResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(issueAfterDisableResponse.json()).error.code).toBe('password_reset_not_available');
    await expect(readPasswordResetCredentialFields(adminPrincipalId)).resolves.toEqual({
      passwordResetOrganizationId: null,
      passwordResetTokenExpiresAt: null,
      passwordResetTokenHash: null,
    });
  });

  it('rejects legacy unscoped bootstrap tokens instead of activating all pending memberships', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const bootstrapToken: string = createToken();
    await insertOrganization('org_beta_dev', 'Beta Dev', 'beta-dev');
    await db.insert(principals).values({
      email: 'pending@example.com',
      id: 'prn_legacy_pending',
      type: 'user',
    });
    await db.insert(localCredentials).values({
      bootstrapTokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      bootstrapTokenHash: hashToken(bootstrapToken, defaultApiConfig.sessionSecret),
      passwordHash: null,
      principalId: 'prn_legacy_pending',
    });
    await insertOrganizationMembership('mem_pending_acme_dev', installPayload.organization.id, 'prn_legacy_pending');
    await insertOrganizationMembership('mem_pending_beta_dev', 'org_beta_dev', 'prn_legacy_pending');
    const pendingCredentialFields: PendingCredentialFields = await readPendingCredentialFields('prn_legacy_pending');

    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      payload: {
        bootstrapToken,
        email: 'pending@example.com',
        password: ['pending', 'activation', 'credential'].join('-'),
      },
      url: authApiActivatePathname,
    });

    expect(response.statusCode).toBe(401);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('invalid_bootstrap_token');
    await expect(readPendingCredentialFields('prn_legacy_pending')).resolves.toEqual(pendingCredentialFields);
    await expect(countAuthSessionsForPrincipal('prn_legacy_pending')).resolves.toBe(0);
  });
});

async function insertOrganization(id: string, name: string, slug: string): Promise<void> {
  await db.insert(organizations).values({
    id,
    name,
    slug,
  });
}

async function insertOrganizationMembership(id: string, organizationId: string, principalId: string): Promise<void> {
  await db.insert(organizationMemberships).values({
    id,
    organizationId,
    principalId,
  });
}

async function deleteOrganizationMembership(organizationId: string, principalId: string): Promise<void> {
  await db
    .delete(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.principalId, principalId),
      ),
    );
}

async function updateOrganizationLocalPasswordEnabled(
  organizationId: string,
  localPasswordEnabled: boolean,
): Promise<void> {
  await db.update(organizations).set({ localPasswordEnabled }).where(eq(organizations.id, organizationId));
}

async function readPrincipalIdByEmail(email: string): Promise<string> {
  const rows: { id: string }[] = await db
    .select({ id: principals.id })
    .from(principals)
    .where(eq(principals.email, email))
    .limit(1);
  const principalId: string | undefined = rows[0]?.id;
  if (principalId === undefined) {
    throw new Error(`Expected principal ${email}.`);
  }

  return principalId;
}

async function readPasswordResetCredentialFields(principalId: string): Promise<PasswordResetCredentialFields> {
  const rows: PasswordResetCredentialFields[] = await db
    .select({
      passwordResetOrganizationId: localCredentials.passwordResetOrganizationId,
      passwordResetTokenExpiresAt: localCredentials.passwordResetTokenExpiresAt,
      passwordResetTokenHash: localCredentials.passwordResetTokenHash,
    })
    .from(localCredentials)
    .where(eq(localCredentials.principalId, principalId));
  const row: PasswordResetCredentialFields | undefined = rows[0];
  if (row === undefined) {
    throw new Error(`Expected local credentials for ${principalId}.`);
  }

  return row;
}

async function readPendingCredentialFields(principalId: string): Promise<PendingCredentialFields> {
  const rows: PendingCredentialFields[] = await db
    .select({
      bootstrapTokenExpiresAt: localCredentials.bootstrapTokenExpiresAt,
      bootstrapTokenHash: localCredentials.bootstrapTokenHash,
      passwordHash: localCredentials.passwordHash,
    })
    .from(localCredentials)
    .where(eq(localCredentials.principalId, principalId));
  const row: PendingCredentialFields | undefined = rows[0];
  if (row === undefined) {
    throw new Error(`Expected pending local credentials for ${principalId}.`);
  }

  return row;
}

function requireResponseSessionToken(response: ResetPasswordResponse): string {
  if (response.sessionToken === undefined) {
    throw new Error('Expected token reset password response.');
  }

  return response.sessionToken;
}

async function readStoredAuthSessionOrganizationFields(
  sessionToken: string,
): Promise<StoredAuthSessionOrganizationFields> {
  const rows: StoredAuthSessionOrganizationFields[] = await db
    .select({
      authMethodKind: authSessions.authMethodKind,
      organizationId: authSessions.organizationId,
    })
    .from(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(sessionToken, defaultApiConfig.sessionSecret)));
  const row: StoredAuthSessionOrganizationFields | undefined = rows[0];
  if (row === undefined) {
    throw new Error('Expected stored auth session.');
  }

  return row;
}

async function countAuthSessionsForPrincipal(principalId: string): Promise<number> {
  const rows: { value: number }[] = await db
    .select({ value: count() })
    .from(authSessions)
    .where(eq(authSessions.principalId, principalId));

  return rows[0]?.value ?? 0;
}

async function expectSessionCannotUseOrganization(sessionToken: string, organizationSlug: string): Promise<void> {
  const response: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: `Bearer ${sessionToken}`,
      [compartmentCurrentOrganizationHeaderName]: organizationSlug,
    },
    method: 'GET',
    url: '/v1/projects',
  });

  expect(response.statusCode).toBe(404);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('organization_not_found');
}
