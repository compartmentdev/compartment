import { and, eq } from 'drizzle-orm';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
  compartmentSessionCookieName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import {
  accessAssignments,
  accessRoles,
  appAccessSessions,
  authSessions,
  localCredentials,
  organizationMemberships,
  principals,
  ssoOidcProviders,
} from '../src/db/schema';
import { authApiLoginPathname } from '../src/routes/auth/auth-api-paths';
import type { ApiApp } from '../src/app.types';
import type { Database } from '../src/db/client';
import { hashToken } from '../src/lib/tokens';
import { encryptVariableValueForStorage, type EncryptedVariableValue } from '../src/lib/variables-crypto';
import { requireSetCookieValue } from './api-integration.harness';

const installAdminCredential: string = 'supersecretpassword';

interface CreateBrowserCookieSessionInput {
  apiApp: ApiApp;
  browserCsrfHeaders: Record<string, string>;
  db: Database;
  organizationSlug?: string | undefined;
  sessionSecret: string;
}

interface CreateOrganizationMemberSessionInput {
  active?: boolean;
  assignRole?: boolean;
  db: Database;
  email?: string;
  organizationId: string;
  principalId?: string;
  role: 'admin' | 'deployer' | 'readonly' | 'viewer';
  sessionId?: string;
  sessionSecret: string;
  sessionToken?: string;
}

interface CreateStoredSsoOidcProviderInput {
  db: Database;
  organizationId: string;
  providerId: string;
  variablesMasterKey: Buffer;
}

interface StoredAuthSessionRow {
  revokedAt: Date | null;
}

export interface StoredBrowserSession {
  sessionId: string;
  sessionToken: string;
}

export async function createBrowserCookieSession(
  input: CreateBrowserCookieSessionInput,
): Promise<StoredBrowserSession> {
  const browserLoginResponse: LightMyRequestResponse = await input.apiApp.inject({
    headers: input.browserCsrfHeaders,
    method: 'POST',
    payload: {
      email: 'admin@example.com',
      password: installAdminCredential,
      sessionDelivery: 'cookie',
      ...(input.organizationSlug !== undefined ? { organizationSlug: input.organizationSlug } : {}),
    },
    url: authApiLoginPathname,
  });
  expect(browserLoginResponse.statusCode).toBe(200);
  const sessionToken: string = requireSetCookieValue(
    browserLoginResponse.headers['set-cookie'],
    compartmentSessionCookieName,
  );

  return {
    sessionId: await readStoredAuthSessionIdByToken(input.db, sessionToken, input.sessionSecret),
    sessionToken,
  };
}

export async function createOrganizationMemberSession(input: CreateOrganizationMemberSessionInput): Promise<string> {
  const principalId: string = input.principalId ?? `prn_${input.role}`;
  const sessionId: string = input.sessionId ?? `ses_${input.role}`;
  const sessionToken: string = input.sessionToken ?? `${input.role}-session-token`;
  const email: string = input.email ?? `${input.role}@example.com`;

  await input.db.insert(principals).values({
    email,
    id: principalId,
    type: 'user',
  });
  await input.db.insert(organizationMemberships).values({
    id: input.assignRole === false ? `mem_${principalId}` : `mem_${input.role}`,
    organizationId: input.organizationId,
    principalId,
  });
  if (input.assignRole ?? true) {
    const roleId: string = await readAccessRoleId(input.db, input.organizationId, input.role);
    await input.db.insert(accessAssignments).values({
      id: `asg_${input.role}`,
      organizationId: input.organizationId,
      roleId,
      scopeId: input.organizationId,
      scopeType: 'organization',
      subjectId: principalId,
      subjectType: 'principal',
    });
  }
  await input.db.insert(authSessions).values({
    authMethodKind: 'password',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    id: sessionId,
    oidcProviderId: null,
    organizationId: input.organizationId,
    principalId,
    tokenHash: hashToken(sessionToken, input.sessionSecret),
  });
  if (input.active ?? true) {
    await input.db.insert(localCredentials).values({
      passwordHash: `${principalId}-password-hash`,
      principalId,
    });
  }

  return sessionToken;
}

export async function createStoredAppAccessSession(
  db: Database,
  sessionSecret: string,
  appSessionId: string,
  authSessionId: string,
): Promise<void> {
  await db.insert(appAccessSessions).values({
    authSessionId,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    host: 'billing.localhost',
    id: appSessionId,
    tokenHash: hashToken(`${appSessionId}-token`, sessionSecret),
  });
}

export async function createStoredSsoOidcProvider(input: CreateStoredSsoOidcProviderInput): Promise<void> {
  const encryptedClientSecret: EncryptedVariableValue = encryptVariableValueForStorage(
    'secret_123',
    input.variablesMasterKey,
  );

  await input.db.insert(ssoOidcProviders).values({
    buttonText: 'Login with Single sign-on',
    clientId: `client_${input.providerId}`,
    clientSecretCiphertext: encryptedClientSecret.valueCiphertext,
    clientSecretEncryptionKeyId: encryptedClientSecret.encryptionKeyId,
    displayName: 'Single sign-on',
    id: input.providerId,
    identityVerificationJson: JSON.stringify(buildDefaultSsoOidcIdentityVerificationConfig()),
    issuerUrl: `https://${input.providerId}.example.com`,
    key: input.providerId.replace(/_/gu, '-'),
    organizationId: input.organizationId,
    preset: 'generic',
    provisioningPolicyJson: JSON.stringify(buildDisabledSsoOidcProvisioningPolicy()),
    scope: 'openid email profile',
    updatedAt: new Date('2026-04-29T10:00:00.000Z'),
  });
}

export async function readStoredAppAccessSession(db: Database, appSessionId: string): Promise<StoredAuthSessionRow> {
  const rows: StoredAuthSessionRow[] = await db
    .select({ revokedAt: appAccessSessions.revokedAt })
    .from(appAccessSessions)
    .where(eq(appAccessSessions.id, appSessionId));
  const row: StoredAuthSessionRow | undefined = rows[0];
  if (row === undefined) {
    throw new Error(`Expected app access session ${appSessionId}.`);
  }

  return row;
}

export async function readStoredAuthSession(db: Database, sessionId: string): Promise<StoredAuthSessionRow> {
  const rows: StoredAuthSessionRow[] = await db
    .select({ revokedAt: authSessions.revokedAt })
    .from(authSessions)
    .where(eq(authSessions.id, sessionId));
  const row: StoredAuthSessionRow | undefined = rows[0];
  if (row === undefined) {
    throw new Error(`Expected auth session ${sessionId}.`);
  }

  return row;
}

export async function readStoredAuthSessionIdByToken(
  db: Database,
  sessionToken: string,
  sessionSecret: string,
): Promise<string> {
  const rows: { id: string }[] = await db
    .select({ id: authSessions.id })
    .from(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(sessionToken, sessionSecret)));
  const sessionId: string | undefined = rows[0]?.id;
  if (sessionId === undefined) {
    throw new Error('Expected stored auth session.');
  }

  return sessionId;
}

export async function readStoredSsoOidcProvider(
  db: Database,
  providerId: string,
): Promise<{ buttonText: string; key: string }> {
  const rows: { buttonText: string; key: string }[] = await db
    .select({ buttonText: ssoOidcProviders.buttonText, key: ssoOidcProviders.key })
    .from(ssoOidcProviders)
    .where(eq(ssoOidcProviders.id, providerId));
  const row: { buttonText: string; key: string } | undefined = rows[0];
  if (row === undefined) {
    throw new Error(`Expected SSO OIDC provider ${providerId}.`);
  }

  return row;
}

async function readAccessRoleId(
  db: Database,
  organizationId: string,
  roleName: 'admin' | 'deployer' | 'readonly' | 'viewer',
): Promise<string> {
  const rows: { id: string }[] = await db
    .select({ id: accessRoles.id })
    .from(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.name, roleName)))
    .limit(1);
  const roleId: string | undefined = rows[0]?.id;
  if (roleId === undefined) {
    throw new Error(`Expected access role ${roleName}.`);
  }

  return roleId;
}
