import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildDisabledSsoOidcProvisioningPolicy } from '@compartment/contracts';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { cliLoginAttempts, organizations, principals, ssoOidcFlows, ssoOidcProviders } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  createCliLoginAttempt,
  deleteStaleCliLoginAttempts,
  findLatestCliLoginAttemptByOnboardingSessionId,
  markCliLoginAttemptAuthenticated,
  markCliLoginAttemptExchangedWithExecutor,
} from '../src/queries/cli-login.query';
import type { CliLoginAttemptRow } from '../src/queries/cli-login.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const cliSsoDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'cli_sso_query');
const apiConfig: ApiConfig = {
  builderProfileDigest: 'sha256:' + 'e'.repeat(64),
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'compartment.localhost',
  databaseUrl: cliSsoDatabaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(cliSsoDatabaseUrl);
const db: Database = createDatabase(pool);

interface CreateAttemptOptions {
  onboardingSessionId?: string | null | undefined;
  organizationId?: string | null | undefined;
}

describe('CLI SSO db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: cliSsoDatabaseUrl,
    db,
    pool,
    setup: createQueryScope,
  });

  it('keeps expired attempts while a linked OIDC flow is still present', async (): Promise<void> => {
    await createAttempt('cla_expired_deleted', new Date('2026-04-21T09:59:00.000Z'));
    await createAttempt('cla_expired_linked', new Date('2026-04-21T09:59:00.000Z'));
    await createAttempt('cla_active', new Date('2099-04-21T10:10:00.000Z'));
    await db.insert(ssoOidcFlows).values({
      cliLoginAttemptId: 'cla_expired_linked',
      expiresAt: new Date('2099-04-21T10:10:00.000Z'),
      flowHost: null,
      flowPath: null,
      flowState: null,
      id: 'sof_linked',
      nonce: 'nonce',
      oidcState: 'oidc-state',
      pkceCodeVerifier: 'pkce',
      providerId: 'sop_123',
      stateHash: 'state-hash',
    });

    await deleteStaleCliLoginAttempts(new Date('2026-04-21T10:00:00.000Z'));

    const rows: { id: string }[] = await db.select({ id: cliLoginAttempts.id }).from(cliLoginAttempts);
    expect(rows.map((row: { id: string }): string => row.id).sort(compareAttemptIds)).toEqual([
      'cla_active',
      'cla_expired_linked',
    ]);
  });

  it('marks an active attempt authenticated only once', async (): Promise<void> => {
    await createAttempt('cla_auth_once', new Date('2099-04-21T10:10:00.000Z'));

    const firstUpdate: boolean = await markCliLoginAttemptAuthenticated(
      'cla_auth_once',
      'org_123',
      'prn_123',
      'password',
      null,
      new Date('2026-04-21T10:00:00.000Z'),
    );
    const secondUpdate: boolean = await markCliLoginAttemptAuthenticated(
      'cla_auth_once',
      'org_123',
      'prn_123',
      'password',
      null,
      new Date('2026-04-21T10:00:01.000Z'),
    );

    const rows: { authenticatedAuthMethodKind: string | null; authenticatedPrincipalId: string | null }[] = await db
      .select({
        authenticatedAuthMethodKind: cliLoginAttempts.authenticatedAuthMethodKind,
        authenticatedPrincipalId: cliLoginAttempts.authenticatedPrincipalId,
      })
      .from(cliLoginAttempts);
    expect(firstUpdate).toBe(true);
    expect(secondUpdate).toBe(false);
    expect(rows[0]?.authenticatedPrincipalId).toBe('prn_123');
    expect(rows[0]?.authenticatedAuthMethodKind).toBe('password');
  });

  it('exchanges an authenticated attempt only once', async (): Promise<void> => {
    await createAttempt('cla_exchange_once', new Date('2099-04-21T10:10:00.000Z'));
    await markCliLoginAttemptAuthenticated(
      'cla_exchange_once',
      'org_123',
      'prn_123',
      'oidc',
      'sop_123',
      new Date('2026-04-21T10:00:00.000Z'),
    );

    const firstExchange: boolean = await markCliLoginAttemptExchangedWithExecutor(
      db,
      'cla_exchange_once',
      new Date('2026-04-21T10:00:02.000Z'),
    );
    const secondExchange: boolean = await markCliLoginAttemptExchangedWithExecutor(
      db,
      'cla_exchange_once',
      new Date('2026-04-21T10:00:03.000Z'),
    );

    const rows: { exchangedAt: Date | null }[] = await db
      .select({ exchangedAt: cliLoginAttempts.exchangedAt })
      .from(cliLoginAttempts);
    expect(firstExchange).toBe(true);
    expect(secondExchange).toBe(false);
    expect(rows[0]?.exchangedAt?.toISOString()).toBe('2026-04-21T10:00:02.000Z');
  });

  it('finds the latest onboarding CLI login attempt scoped to an organization', async (): Promise<void> => {
    await createAttempt('cla_same_org', new Date('2099-04-21T10:10:00.000Z'), {
      onboardingSessionId: 'fdo_123',
      organizationId: 'org_123',
    });
    await createAttempt('cla_other_org', new Date('2099-04-21T10:10:00.000Z'), {
      onboardingSessionId: 'fdo_123',
      organizationId: 'org_456',
    });

    const latest: CliLoginAttemptRow | undefined = await findLatestCliLoginAttemptByOnboardingSessionId(
      'fdo_123',
      'org_123',
    );

    expect(latest?.id).toBe('cla_same_org');
    expect(latest?.onboardingSessionId).toBe('fdo_123');
    expect(latest?.organizationId).toBe('org_123');
  });
});

async function createQueryScope(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    localPasswordEnabled: false,
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
  await db.insert(organizations).values({
    id: 'org_456',
    localPasswordEnabled: false,
    name: 'Other Dev',
    slug: 'other-dev',
  });
  await db.insert(principals).values({
    email: 'admin@example.com',
    id: 'prn_123',
    type: 'user',
  });
  await db.insert(ssoOidcProviders).values({
    buttonText: 'Continue with SSO',
    clientId: 'client_123',
    clientSecretCiphertext: 'ciphertext',
    clientSecretEncryptionKeyId: 'key-id',
    displayName: 'Acme SSO',
    id: 'sop_123',
    identityVerificationJson: '{"emailClaims":[],"emailVerifiedClaims":[],"verifiedEmailClaims":[]}',
    issuerUrl: 'https://idp.example.com',
    key: 'acme-sso',
    organizationId: 'org_123',
    preset: 'generic',
    provisioningPolicyJson: JSON.stringify(buildDisabledSsoOidcProvisioningPolicy()),
    scope: 'openid email profile',
    updatedAt: new Date('2026-04-21T10:00:00.000Z'),
  });
}

async function createAttempt(id: string, expiresAt: Date, options: CreateAttemptOptions = {}): Promise<void> {
  await createCliLoginAttempt({
    browserCodeHash: `${id}-browser-hash`,
    exchangeSecretHash: `${id}-exchange-hash`,
    expectedPrincipalEmail: 'admin@example.com',
    expiresAt,
    id,
    onboardingSessionId: options.onboardingSessionId ?? null,
    organizationId: options.organizationId ?? 'org_123',
  });
}

function compareAttemptIds(left: string, right: string): number {
  return left.localeCompare(right);
}
