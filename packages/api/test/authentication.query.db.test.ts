import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { authSessions, organizations, principals, ssoOidcProviders } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  listActiveAuthenticationSessionIdsByOidcProvider,
  revokeActivePasswordSessionsByOrganization,
} from '../src/queries/authentication.query';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const authenticationQueryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'authentication_query');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'compartment.localhost',
  databaseUrl: authenticationQueryDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  runtimeControlToken: 'test-runtime-control-token',
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(authenticationQueryDatabaseUrl);
const db: Database = createDatabase(pool);

describe('authentication db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: authenticationQueryDatabaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await createOrganization('org_123', 'acme-dev');
      await createOrganization('org_456', 'beta-dev');
      await createPrincipal('prn_123', 'admin@example.com');
      await createPrincipal('prn_456', 'viewer@example.com');
    },
  });

  it('revokes only active password sessions in the selected organization', async (): Promise<void> => {
    const revokedAt: Date = new Date('2026-04-29T10:00:00.000Z');
    await createAuthSession({
      authMethodKind: 'password',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_match',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    await createAuthSession({
      authMethodKind: 'password_scoped',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_scoped_match',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    await createAuthSession({
      authMethodKind: 'password',
      expiresAt: new Date('2026-04-29T09:59:00.000Z'),
      id: 'ses_expired',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    await createAuthSession({
      authMethodKind: 'password',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_other_org',
      organizationId: 'org_456',
      principalId: 'prn_123',
    });
    await createAuthSession({
      authMethodKind: 'oidc',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_other_method',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    await createAuthSession({
      authMethodKind: 'password',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_already_revoked',
      organizationId: 'org_123',
      principalId: 'prn_123',
      revokedAt: new Date('2026-04-29T09:00:00.000Z'),
    });

    const revokedSessionIds: string[] = await revokeActivePasswordSessionsByOrganization({
      organizationId: 'org_123',
      revokedAt,
    });

    expect(revokedSessionIds).toEqual(expect.arrayContaining(['ses_match', 'ses_scoped_match']));
    expect(revokedSessionIds).toHaveLength(2);
    await expect(readSessionRevokedAt('ses_match')).resolves.toEqual(revokedAt);
    await expect(readSessionRevokedAt('ses_scoped_match')).resolves.toEqual(revokedAt);
    await expect(readSessionRevokedAt('ses_expired')).resolves.toBeNull();
    await expect(readSessionRevokedAt('ses_other_org')).resolves.toBeNull();
    await expect(readSessionRevokedAt('ses_other_method')).resolves.toBeNull();
    await expect(readSessionRevokedAt('ses_already_revoked')).resolves.toEqual(new Date('2026-04-29T09:00:00.000Z'));
  });

  it('lists only active OIDC sessions for the selected provider and organization', async (): Promise<void> => {
    await createSsoOidcProvider('sop_123', 'org_123');
    await createSsoOidcProvider('sop_456', 'org_123');
    await createAuthSession({
      authMethodKind: 'oidc',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_match',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    await createAuthSession({
      authMethodKind: 'oidc',
      expiresAt: new Date('2026-04-29T09:59:00.000Z'),
      id: 'ses_expired',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    await createAuthSession({
      authMethodKind: 'oidc',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_other_provider',
      oidcProviderId: 'sop_456',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
    await createAuthSession({
      authMethodKind: 'oidc',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_other_org',
      oidcProviderId: 'sop_123',
      organizationId: 'org_456',
      principalId: 'prn_456',
    });
    await createAuthSession({
      authMethodKind: 'oidc',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'ses_revoked',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
      revokedAt: new Date('2026-04-29T09:00:00.000Z'),
    });

    const sessionIds: string[] = await listActiveAuthenticationSessionIdsByOidcProvider({
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
    });

    expect(sessionIds).toEqual(['ses_match']);
  });
});

interface CreateAuthSessionOverrides {
  oidcProviderId?: string | null | undefined;
  revokedAt?: Date | null | undefined;
}

async function createOrganization(id: string, slug: string): Promise<void> {
  await db.insert(organizations).values({
    id,
    name: slug,
    slug,
  });
}

async function createPrincipal(id: string, email: string): Promise<void> {
  await db.insert(principals).values({
    email,
    id,
    type: 'user',
  });
}

async function createSsoOidcProvider(id: string, organizationId: string): Promise<void> {
  await db.insert(ssoOidcProviders).values({
    buttonText: 'Login with Single sign-on',
    clientId: `client_${id}`,
    clientSecretCiphertext: 'ciphertext',
    clientSecretEncryptionKeyId: 'key-id',
    displayName: 'Single sign-on',
    id,
    identityVerificationJson: JSON.stringify(buildDefaultSsoOidcIdentityVerificationConfig()),
    issuerUrl: `https://${id}.example.com`,
    key: id.replace(/_/gu, '-'),
    organizationId,
    preset: 'generic',
    provisioningPolicyJson: JSON.stringify(buildDisabledSsoOidcProvisioningPolicy()),
    scope: 'openid email profile',
    updatedAt: new Date('2026-04-29T09:00:00.000Z'),
  });
}

async function createAuthSession(
  input: {
    authMethodKind: 'oidc' | 'password' | 'password_scoped';
    expiresAt: Date;
    id: string;
    organizationId: string | null;
    principalId: string;
  } & CreateAuthSessionOverrides,
): Promise<void> {
  await db.insert(authSessions).values({
    authMethodKind: input.authMethodKind,
    expiresAt: input.expiresAt,
    id: input.id,
    oidcProviderId: input.oidcProviderId ?? null,
    organizationId: input.organizationId,
    principalId: input.principalId,
    revokedAt: input.revokedAt ?? null,
    tokenHash: `${input.id}-token-hash`,
  });
}

async function readSessionRevokedAt(sessionId: string): Promise<Date | null> {
  const rows: { revokedAt: Date | null }[] = await db
    .select({ revokedAt: authSessions.revokedAt })
    .from(authSessions)
    .where(eq(authSessions.id, sessionId));

  return rows[0]?.revokedAt ?? null;
}
