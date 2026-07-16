import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../../test-support/src';
import { defaultApiAuthThrottleConfig } from '../auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from '../audit-file-sink-config.fixture';
import { type ApiConfig } from '../../src/config';
import { createDatabase, createDatabasePool, type Database } from '../../src/db/client';
import type { ApiDatabaseTransaction } from '../../src/db/client.types';
import { organizations, principals, ssoOidcFlows, ssoOidcIdentities, ssoOidcProviders } from '../../src/db/schema';
import { parseVariablesMasterKey } from '../../src/lib/variables-crypto';
import {
  createSsoOidcFlow,
  createSsoOidcProvider,
  deleteSsoOidcProviderByIdWithExecutor,
  deleteStaleSsoOidcFlows,
  linkSsoOidcIdentityWithExecutor,
  listSsoOidcProvidersByOrganization,
  replaceSsoOidcProviderWithExecutor,
} from '../../src/queries/sso-oidc.query';
import type {
  CreateSsoOidcProviderInput,
  DeleteSsoOidcProviderResult,
  SsoOidcFlowRow,
  SsoOidcProviderRow,
} from '../../src/queries/sso-oidc.query.types';
import { useApiRuntimeDatabaseTestHarness } from '../api-db-test.harness';

interface CreateProviderOverrides {
  clientId?: string | undefined;
  id?: string | undefined;
  identityVerificationJson?: string | undefined;
  issuerUrl?: string | undefined;
  key?: string | undefined;
  provisioningPolicyJson?: string | undefined;
}

const { testDatabaseUrl } = readDatabaseTestMode();
const ssoOidcQueryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'sso_oidc_query');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'compartment.localhost',
  databaseUrl: ssoOidcQueryDatabaseUrl,
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
const pool: Pool = createDatabasePool(ssoOidcQueryDatabaseUrl);
const db: Database = createDatabase(pool);

describe('SSO OIDC db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: ssoOidcQueryDatabaseUrl,
    db,
    pool,
  });

  it('replaces provider state when the OIDC identity namespace changes', async (): Promise<void> => {
    await createOrganization();
    await createPrincipal();
    const provider: SsoOidcProviderRow = await createSsoOidcProvider(createProviderInput({ id: 'sop_initial' }));

    await linkSsoOidcIdentityWithExecutor(db, {
      id: 'soi_initial',
      lastLoginAt: new Date('2026-04-21T10:00:00.000Z'),
      principalId: 'prn_123',
      providerId: provider.id,
      subject: 'subject-initial',
    });
    await createSsoOidcFlow({
      cliLoginAttemptId: null,
      expiresAt: new Date('2099-04-21T10:10:00.000Z'),
      flowHost: 'billing.apps.localhost',
      flowPath: '/',
      flowState: 'app-state',
      id: 'sof_initial',
      nonce: 'nonce',
      oidcState: 'oidc-state',
      pkceCodeVerifier: 'pkce-verifier',
      providerId: provider.id,
      stateHash: 'state-hash',
    });

    const replacement: SsoOidcProviderRow = await db.transaction(
      async (transaction: ApiDatabaseTransaction): Promise<SsoOidcProviderRow> =>
        await replaceSsoOidcProviderWithExecutor(
          transaction,
          createProviderInput({
            id: 'sop_initial',
            issuerUrl: 'https://idp.two.example',
          }),
        ),
    );

    await expect(db.select().from(ssoOidcProviders)).resolves.toHaveLength(1);
    await expect(db.select().from(ssoOidcIdentities)).resolves.toHaveLength(0);
    await expect(db.select().from(ssoOidcFlows)).resolves.toHaveLength(0);
    expect(replacement.id).toBe('sop_initial');
    expect(replacement.createdAt).toEqual(provider.createdAt);
    expect(replacement.issuerUrl).toBe('https://idp.two.example');
  });

  it('deletes expired and consumed OIDC flows', async (): Promise<void> => {
    await createOrganization();
    const provider: SsoOidcProviderRow = await createSsoOidcProvider(createProviderInput({ id: 'sop_cleanup' }));
    await createFlow(provider.id, 'sof_expired', new Date('2026-04-21T09:59:00.000Z'), null);
    await createFlow(
      provider.id,
      'sof_consumed',
      new Date('2026-04-21T10:10:00.000Z'),
      new Date('2026-04-21T10:00:00.000Z'),
    );
    await createFlow(provider.id, 'sof_active', new Date('2026-04-21T10:10:00.000Z'), null);

    await deleteStaleSsoOidcFlows(new Date('2026-04-21T10:00:00.000Z'));

    const rows: SsoOidcFlowRow[] = await db.select().from(ssoOidcFlows);
    expect(rows.map((row: SsoOidcFlowRow): string => row.id)).toEqual(['sof_active']);
  });

  it('persists custom OIDC identity verification config', async (): Promise<void> => {
    await createOrganization();
    const identityVerificationJson: string = JSON.stringify({
      emailClaims: [{ claim: 'email', source: 'userinfo' }],
      emailVerifiedClaims: [{ claim: 'email_verified', equals: true, source: 'userinfo' }],
      verifiedEmailClaims: [],
    });

    const provider: SsoOidcProviderRow = await createSsoOidcProvider(
      createProviderInput({
        identityVerificationJson,
      }),
    );

    expect(provider.identityVerification).toEqual(JSON.parse(identityVerificationJson));
  });

  it('persists custom OIDC provisioning policy config', async (): Promise<void> => {
    await createOrganization();
    const provisioningPolicyJson: string = JSON.stringify({
      allowedEmailDomains: ['example.com'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });

    const provider: SsoOidcProviderRow = await createSsoOidcProvider(
      createProviderInput({
        provisioningPolicyJson,
      }),
    );

    expect(provider.provisioning).toEqual(JSON.parse(provisioningPolicyJson));
  });

  it('persists provider keys alongside provider rows', async (): Promise<void> => {
    await createOrganization();

    const provider: SsoOidcProviderRow = await createSsoOidcProvider(
      createProviderInput({
        key: 'google-workspace',
      }),
    );

    expect(provider.key).toBe('google-workspace');
  });

  it('fails clearly when stored OIDC identity verification config is malformed', async (): Promise<void> => {
    await createOrganization();
    await db.insert(ssoOidcProviders).values(
      createProviderInput({
        identityVerificationJson: 'not-json',
      }),
    );

    await expect(listSsoOidcProvidersByOrganization('org_123')).rejects.toThrow(
      'Stored SSO OIDC identity verification config is invalid.',
    );
  });

  it('fails clearly when stored OIDC provisioning policy config is malformed', async (): Promise<void> => {
    await createOrganization();
    await db.insert(ssoOidcProviders).values(
      createProviderInput({
        provisioningPolicyJson: 'not-json',
      }),
    );

    await expect(listSsoOidcProvidersByOrganization('org_123')).rejects.toThrow(
      'Stored SSO OIDC provisioning policy is invalid.',
    );
  });

  it('keeps the last SSO provider when local password login is disabled', async (): Promise<void> => {
    await createOrganization();
    await db.update(organizations).set({ localPasswordEnabled: false });
    const provider: SsoOidcProviderRow = await createSsoOidcProvider(createProviderInput({ id: 'sop_last' }));

    const result: DeleteSsoOidcProviderResult = await db.transaction(
      async (transaction: ApiDatabaseTransaction): Promise<DeleteSsoOidcProviderResult> =>
        await deleteSsoOidcProviderByIdWithExecutor(transaction, {
          organizationId: 'org_123',
          providerId: provider.id,
        }),
    );

    await expect(db.select().from(ssoOidcProviders)).resolves.toHaveLength(1);
    expect(result).toBe('login_method_required');
  });
});

async function createOrganization(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
}

async function createPrincipal(): Promise<void> {
  await db.insert(principals).values({
    email: 'admin@example.com',
    id: 'prn_123',
    type: 'user',
  });
}

function createProviderInput(overrides: CreateProviderOverrides): CreateSsoOidcProviderInput {
  return {
    buttonText: 'Login with Single sign-on',
    clientId: overrides.clientId ?? 'client_123',
    clientSecretCiphertext: 'ciphertext',
    clientSecretEncryptionKeyId: 'key-id',
    displayName: 'Single sign-on',
    id: overrides.id ?? 'sop_123',
    identityVerificationJson:
      overrides.identityVerificationJson ?? JSON.stringify(buildDefaultSsoOidcIdentityVerificationConfig()),
    issuerUrl: overrides.issuerUrl ?? 'https://idp.one.example',
    key: overrides.key ?? 'single-sign-on',
    organizationId: 'org_123',
    preset: 'generic',
    provisioningPolicyJson:
      overrides.provisioningPolicyJson ?? JSON.stringify(buildDisabledSsoOidcProvisioningPolicy()),
    scope: 'openid email profile',
    updatedAt: new Date('2026-04-21T10:00:00.000Z'),
  };
}

async function createFlow(providerId: string, id: string, expiresAt: Date, consumedAt: Date | null): Promise<void> {
  await db.insert(ssoOidcFlows).values({
    consumedAt,
    expiresAt,
    flowHost: 'billing.apps.localhost',
    flowPath: '/',
    flowState: id,
    id,
    nonce: `${id}-nonce`,
    oidcState: `${id}-oidc-state`,
    pkceCodeVerifier: `${id}-verifier`,
    providerId,
    stateHash: `${id}-state-hash`,
  });
}
