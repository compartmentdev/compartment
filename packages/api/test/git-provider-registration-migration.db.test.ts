import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  deriveProcessScopedDatabaseUrl,
  ensureDatabaseExists,
  readDatabaseTestMode,
  resetDatabase,
} from '@compartment/test-support';
import { Pool, type QueryResult } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'git_provider_registration_migration');
const pool: Pool = new Pool({ connectionString: databaseUrl });
const initialMigrationPath: string = resolve(__dirname, '../drizzle/0000_initial.sql');
const providerMigrationPath: string = resolve(__dirname, '../drizzle/0001_concerned_swarm.sql');

describe('git provider registration migration', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureDatabaseExists(databaseUrl);
  });

  beforeEach(async (): Promise<void> => {
    await resetDatabase(databaseUrl);
    await pool.query(await readFile(initialMigrationPath, 'utf8'));
    await seedReleasedRegistrationScope();
  });

  afterAll(async (): Promise<void> => {
    await pool.end();
  });

  it('backfills organization scope and moves active GitHub credentials to the provider table', async (): Promise<void> => {
    await insertReleasedGitHubRegistration(
      'https://console.example/v1/sources/git/providers/github/organizations/org_migration/registrations/gpr_migration/webhook',
    );

    await pool.query(await readFile(providerMigrationPath, 'utf8'));

    const result: QueryResult<{ organization_id: string }> = await pool.query(
      'select organization_id from git_provider_registrations where id = $1',
      ['gpr_migration'],
    );
    expect(result.rows).toEqual([{ organization_id: 'org_migration' }]);
    const credentials: QueryResult<Record<string, string>> = await pool.query(
      'select * from github_app_registration_credentials where registration_id = $1',
      ['gpr_migration'],
    );
    expect(credentials.rows).toEqual([
      {
        app_id: '1',
        app_name: 'Compartment',
        app_slug: 'compartment',
        app_url: 'https://github.com/apps/compartment',
        installation_account_login: 'acme',
        installation_account_type: 'Organization',
        installation_id: '2',
        private_key_pem_ciphertext: 'ciphertext',
        private_key_pem_encryption_key_id: 'key',
        registration_id: 'gpr_migration',
      },
    ]);
    const removedColumns: QueryResult<{ column_name: string }> = await pool.query(
      `select column_name from information_schema.columns
       where table_name = 'git_provider_registrations'
         and column_name in ('app_id', 'app_name', 'app_slug', 'app_url', 'installation_id',
           'installation_account_login', 'installation_account_type', 'private_key_pem_ciphertext',
           'private_key_pem_encryption_key_id', 'access_token_ciphertext',
           'access_token_encryption_key_id', 'access_token_expires_at')`,
    );
    expect(removedColumns.rows).toEqual([]);
  });

  it('aborts when a released registration webhook URL cannot be scoped', async (): Promise<void> => {
    await insertReleasedGitHubRegistration(
      'https://console.example/v1/sources/git/providers/github/registrations/gpr_migration/webhook',
    );

    await expect(pool.query(await readFile(providerMigrationPath, 'utf8'))).rejects.toThrow(
      'Cannot backfill git_provider_registrations.organization_id from webhook_url',
    );
  });

  it('aborts before dropping an incomplete active GitHub credential', async (): Promise<void> => {
    await insertReleasedGitHubRegistration(
      'https://console.example/v1/sources/git/providers/github/organizations/org_migration/registrations/gpr_migration/webhook',
    );
    await pool.query('update git_provider_registrations set app_id = null where id = $1', ['gpr_migration']);

    await expect(pool.query(await readFile(providerMigrationPath, 'utf8'))).rejects.toThrow(
      'Cannot migrate incomplete active GitHub App registration credentials',
    );
  });

  it('enforces credential shape with table nullability and cascades registration deletion', async (): Promise<void> => {
    await insertReleasedGitHubRegistration(
      'https://console.example/v1/sources/git/providers/github/organizations/org_migration/registrations/gpr_migration/webhook',
    );
    await pool.query(await readFile(providerMigrationPath, 'utf8'));

    const nullableColumns: QueryResult<{ column_name: string; is_nullable: string; table_name: string }> =
      await pool.query(
        `select table_name, column_name, is_nullable from information_schema.columns
         where table_name in ('github_app_registration_credentials', 'gitlab_token_registration_credentials')
         order by table_name, ordinal_position`,
      );
    expect(
      nullableColumns.rows.filter(
        (column: { column_name: string; is_nullable: string; table_name: string }): boolean =>
          column.is_nullable === 'YES',
      ),
    ).toEqual([
      {
        column_name: 'access_token_expires_at',
        is_nullable: 'YES',
        table_name: 'gitlab_token_registration_credentials',
      },
    ]);
    await expect(
      pool.query(
        `insert into github_app_registration_credentials
         (registration_id, app_id, app_name, app_slug, app_url, installation_account_login,
          installation_account_type, installation_id, private_key_pem_ciphertext,
          private_key_pem_encryption_key_id)
         values ('missing', null, 'name', 'slug', 'url', 'login', 'Organization', '2', 'ciphertext', 'key')`,
      ),
    ).rejects.toThrow();

    await pool.query('delete from git_provider_registrations where id = $1', ['gpr_migration']);
    const credentials: QueryResult = await pool.query('select 1 from github_app_registration_credentials');
    expect(credentials.rows).toEqual([]);
  });
});

async function seedReleasedRegistrationScope(): Promise<void> {
  await pool.query(
    "insert into principals (id, type, email) values ('prn_migration', 'user', 'migration@example.com')",
  );
  await pool.query("insert into organizations (id, slug, name) values ('org_migration', 'migration', 'Migration')");
}

async function insertReleasedGitHubRegistration(webhookUrl: string): Promise<void> {
  await pool.query(
    `insert into git_provider_registrations (
      id, provider_type, provider_host, repository_owner, status, app_id, app_name, app_slug, app_url,
      installation_account_login, installation_account_type, installation_id,
      private_key_pem_ciphertext, private_key_pem_encryption_key_id, webhook_secret_ciphertext,
      webhook_secret_encryption_key_id, webhook_url, callback_url, created_by_principal_id
    ) values ($1, 'github_app', 'github.com', 'acme', 'active', '1', 'Compartment', 'compartment',
      'https://github.com/apps/compartment', 'acme', 'Organization', '2', 'ciphertext', 'key',
      'secret', 'key', $2, 'https://console.example/callback', 'prn_migration')`,
    ['gpr_migration', webhookUrl],
  );
}
