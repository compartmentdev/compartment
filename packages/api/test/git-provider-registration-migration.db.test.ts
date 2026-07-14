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

  it('backfills organization scope from a released GitHub webhook URL', async (): Promise<void> => {
    await insertReleasedGitHubRegistration(
      'https://console.example/v1/sources/git/providers/github/organizations/org_migration/registrations/gpr_migration/webhook',
    );

    await pool.query(await readFile(providerMigrationPath, 'utf8'));

    const result: QueryResult<{ organization_id: string }> = await pool.query(
      'select organization_id from git_provider_registrations where id = $1',
      ['gpr_migration'],
    );
    expect(result.rows).toEqual([{ organization_id: 'org_migration' }]);
  });

  it('aborts when a released registration webhook URL cannot be scoped', async (): Promise<void> => {
    await insertReleasedGitHubRegistration(
      'https://console.example/v1/sources/git/providers/github/registrations/gpr_migration/webhook',
    );

    await expect(pool.query(await readFile(providerMigrationPath, 'utf8'))).rejects.toThrow(
      'Cannot backfill git_provider_registrations.organization_id from webhook_url',
    );
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
      id, provider_type, provider_host, repository_owner, status, app_id, installation_id,
      private_key_pem_ciphertext, private_key_pem_encryption_key_id, webhook_secret_ciphertext,
      webhook_secret_encryption_key_id, webhook_url, callback_url, created_by_principal_id
    ) values ($1, 'github_app', 'github.com', 'acme', 'active', '1', '2', 'ciphertext', 'key',
      'secret', 'key', $2, 'https://console.example/callback', 'prn_migration')`,
    ['gpr_migration', webhookUrl],
  );
}
