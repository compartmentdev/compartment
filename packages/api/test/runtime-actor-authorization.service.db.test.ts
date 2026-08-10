import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveProcessScopedDatabaseUrl,
  ensureDatabaseExists,
  readDatabaseTestMode,
  resetDatabase,
} from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  gitProviderRegistrations,
  localCredentials,
  organizationMemberships,
  organizations,
  principals,
  ssoOidcIdentities,
  ssoOidcProviders,
  sources,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';
import {
  requireActiveHumanRuntimeActor,
  requireActiveSourceAutomationRuntimeActor,
} from '../src/services/runtime-actor-authorization.service';
import { runCompartmentApiMigrations as runApiMigrations } from '@compartment/test-support';
import { createApiTestConfig } from './api-config-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'runtime_actor_authorization_service');
const apiConfig: ApiConfig = createApiTestConfig({
  databaseUrl,
  tenantSecretsKek: parseVariablesMasterKey('44'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('44'.repeat(32)),
});
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('runtime actor authorization service', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureDatabaseExists(databaseUrl);
  });

  beforeEach(async (): Promise<void> => {
    await resetDatabase(databaseUrl);
    await runApiMigrations(databaseUrl);
    configureApiRuntime({
      config: apiConfig,
      db,
    });
    await seedRuntimeAuthorizationScope();
  });

  afterEach((): void => {
    clearApiRuntime();
  });

  afterAll(async (): Promise<void> => {
    await pool.end();
  });

  it('allows active human runtime actors with an enabled login method', async (): Promise<void> => {
    await expect(
      requireActiveHumanRuntimeActor({
        organizationId: 'org_123',
        principalId: 'prn_human_active',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects invited humans without an enabled login method', async (): Promise<void> => {
    await expect(
      requireActiveHumanRuntimeActor({
        organizationId: 'org_123',
        principalId: 'prn_human_invited',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects SSO identities that belong to another organization', async (): Promise<void> => {
    await db.insert(ssoOidcProviders).values({
      buttonText: 'Login with Single sign-on',
      clientId: 'client_123',
      clientSecretCiphertext: 'ciphertext',
      clientSecretEncryptionKeyId: 'key-id',
      displayName: 'Single sign-on',
      id: 'sop_456',
      identityVerificationJson: '{}',
      issuerUrl: 'https://idp.example.com',
      key: 'single-sign-on',
      organizationId: 'org_456',
      preset: 'generic',
      provisioningPolicyJson: '{}',
      scope: 'openid email profile',
      updatedAt: new Date('2026-05-01T09:00:00.000Z'),
    });
    await db.insert(ssoOidcIdentities).values({
      id: 'soi_human_invited_other_org',
      principalId: 'prn_human_invited',
      providerId: 'sop_456',
      subject: 'subject_human_invited_other_org',
    });

    await expect(
      requireActiveHumanRuntimeActor({
        organizationId: 'org_123',
        principalId: 'prn_human_invited',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('allows only the matching active source automation principal', async (): Promise<void> => {
    await expect(
      requireActiveSourceAutomationRuntimeActor({
        organizationId: 'org_123',
        principalId: 'prn_git_auto',
        sourceId: 'src_123',
      }),
    ).resolves.toMatchObject({ id: 'src_123' });
  });

  it('rejects blocked or disabled automation principals', async (): Promise<void> => {
    await db
      .update(organizationMemberships)
      .set({ blockedAt: new Date('2026-05-01T10:00:00.000Z') })
      .where(eq(organizationMemberships.principalId, 'prn_git_auto'));

    await expect(
      requireActiveSourceAutomationRuntimeActor({
        organizationId: 'org_123',
        principalId: 'prn_git_auto',
        sourceId: 'src_123',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await db
      .update(organizationMemberships)
      .set({ blockedAt: null })
      .where(eq(organizationMemberships.principalId, 'prn_git_auto'));
    await db.update(sources).set({ status: 'disabled' }).where(eq(sources.id, 'src_123'));

    await expect(
      requireActiveSourceAutomationRuntimeActor({
        organizationId: 'org_123',
        principalId: 'prn_git_auto',
        sourceId: 'src_123',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

async function seedRuntimeAuthorizationScope(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
  await db.insert(organizations).values({
    id: 'org_456',
    name: 'Beta Dev',
    slug: 'beta-dev',
  });
  await db.insert(principals).values([
    {
      email: 'active@example.com',
      id: 'prn_human_active',
      type: 'user',
    },
    {
      email: 'invited@example.com',
      id: 'prn_human_invited',
      type: 'user',
    },
    {
      email: 'git-source+src_123@compartment.internal',
      id: 'prn_git_auto',
      type: 'automation',
    },
  ]);
  await db.insert(organizationMemberships).values([
    {
      id: 'mem_human_active',
      principalId: 'prn_human_active',
      organizationId: 'org_123',
    },
    {
      id: 'mem_human_invited',
      principalId: 'prn_human_invited',
      organizationId: 'org_123',
    },
    {
      id: 'mem_git_auto',
      principalId: 'prn_git_auto',
      organizationId: 'org_123',
    },
  ]);
  await db.insert(localCredentials).values({
    passwordHash: 'active-password-hash',
    principalId: 'prn_human_active',
    updatedAt: new Date('2026-05-01T09:00:00.000Z'),
  });
  await db.insert(gitProviderRegistrations).values({
    callbackUrl: 'https://console.example.com/callback',
    createdByPrincipalId: 'prn_human_active',
    id: 'gpr_123',
    organizationId: 'org_123',
    providerHost: 'github.example.com',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    webhookUrl:
      'https://console.example.com/v1/sources/git/providers/github/organizations/org_123/registrations/gpr_123/webhook',
    updatedAt: new Date('2026-05-01T09:00:00.000Z'),
  });
  await db.insert(sources).values({
    automationPrincipalId: 'prn_git_auto',
    autoAdoptNewApps: true,
    createdByPrincipalId: 'prn_human_active',
    defaultAutoDeployEnabled: true,
    defaultBranchName: 'main',
    defaultEnvironmentName: 'production',
    displayName: 'Acme Git Source',
    id: 'src_123',
    organizationId: 'org_123',
    providerHost: 'github.example.com',
    providerInstallationId: 'inst_123',
    providerRegistrationId: 'gpr_123',
    repositoryCloneUrl: 'https://github.example.com/acme/platform.git',
    repositoryExternalId: 'repo_123',
    repositoryName: 'platform',
    repositoryOwner: 'acme',
    status: 'active',
    syncBranchName: 'main',
    type: 'git',
    updatedAt: new Date('2026-05-01T09:00:00.000Z'),
  });
}
