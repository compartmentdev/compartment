import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { deriveDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { localCredentials, organizationMemberships, organizations, principals } from '../src/db/schema';
import { findLoginRowByEmailWithExecutor } from '../src/queries/login.query';
import type { LoginRow } from '../src/queries/login.query.types';
import { listOrganizationRowsForPrincipalEmail } from '../src/queries/organizations.query';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import {
  createPrincipalIfMissingWithExecutor,
  createPrincipalWithExecutor,
  findOrganizationUserByEmail,
  findPrincipalCredentialByEmail,
} from '../src/queries/organization-users.query';
import type {
  OrganizationUserRow,
  OrganizationUsersTransaction,
  PrincipalCredentialRow,
} from '../src/queries/organization-users.query.types';
import { findPrincipalCredentialByEmailWithExecutor } from '../src/queries/principal-credentials.query';
import { findOrganizationSsoPrincipalByEmailWithExecutor } from '../src/queries/sso-oidc-principal.query';
import type { SsoOidcPrincipalRow } from '../src/queries/sso-oidc.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { createApiTestConfig } from './api-config-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const principalEmailQueryDatabaseUrl: string = deriveDatabaseUrl(testDatabaseUrl, 'principal_email_query');
const apiConfig: ApiConfig = createApiTestConfig({
  databaseUrl: principalEmailQueryDatabaseUrl,
});
const pool: Pool = createDatabasePool(principalEmailQueryDatabaseUrl);
const db: Database = createDatabase(pool);

describe('principal email queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: principalEmailQueryDatabaseUrl,
    db,
    pool,
    setup: seedPrincipalScope,
  });

  it('resolves password login and activation principals case-insensitively', async (): Promise<void> => {
    const loginRow: LoginRow | undefined = await findLoginRowByEmailWithExecutor(db, 'admin@example.com');
    const principalCredential: PrincipalCredentialRow | undefined =
      await findPrincipalCredentialByEmail('ADMIN@EXAMPLE.COM');

    expect(loginRow).toMatchObject({
      passwordHash: 'password-hash',
      principalEmail: 'Admin@Example.com',
      principalId: 'prn_123',
      principalType: 'user',
    });
    expect(principalCredential).toMatchObject({
      email: 'Admin@Example.com',
      passwordHash: 'password-hash',
      principalId: 'prn_123',
    });
  });

  it('resolves organization user and browser discovery lookups case-insensitively', async (): Promise<void> => {
    const organizationUser: OrganizationUserRow | undefined = await findOrganizationUserByEmail(
      'org_123',
      'admin@example.com',
    );
    const organizationRows: OrganizationRow[] = await listOrganizationRowsForPrincipalEmail('ADMIN@example.com');

    expect(organizationUser).toMatchObject({
      email: 'Admin@Example.com',
      id: 'prn_123',
    });
    expect(organizationRows).toEqual([
      {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ]);
  });

  it('resolves first-time SSO principal lookup case-insensitively', async (): Promise<void> => {
    const principal: SsoOidcPrincipalRow | undefined = await findOrganizationSsoPrincipalByEmailWithExecutor(
      db,
      'org_123',
      'admin@example.com',
    );

    expect(principal).toEqual({
      principalEmail: 'Admin@Example.com',
      principalId: 'prn_123',
      principalType: 'user',
    });
  });

  it('keeps the transaction usable when a duplicate principal create is ignored', async (): Promise<void> => {
    await db.transaction(async (transaction: OrganizationUsersTransaction): Promise<void> => {
      await createPrincipalWithExecutor(transaction, {
        email: 'race@example.com',
        principalId: 'prn_race_a',
      });
      await createPrincipalIfMissingWithExecutor(transaction, {
        email: 'RACE@example.com',
        principalId: 'prn_race_b',
      });

      const principalCredential: PrincipalCredentialRow | undefined = await findPrincipalCredentialByEmailWithExecutor(
        transaction,
        'race@example.com',
      );

      expect(principalCredential?.principalId).toBe('prn_race_a');
    });
  });
});

async function seedPrincipalScope(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
  await db.insert(principals).values({
    email: 'Admin@Example.com',
    id: 'prn_123',
    type: 'user',
  });
  await db.insert(organizationMemberships).values({
    id: 'mem_123',
    principalId: 'prn_123',
    organizationId: 'org_123',
  });
  await db.insert(localCredentials).values({
    passwordHash: 'password-hash',
    principalId: 'prn_123',
    updatedAt: new Date('2026-04-27T10:00:00.000Z'),
  });
}
