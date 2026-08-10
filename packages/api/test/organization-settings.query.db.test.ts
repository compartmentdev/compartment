import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { organizations } from '../src/db/schema';
import { findOrganizationSettings, updateOrganizationSettings } from '../src/queries/organization-settings.query';
import type { OrganizationSettingsRow } from '../src/queries/organization-settings.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { createApiTestConfig } from './api-config-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const organizationSettingsQueryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'organization_settings_query',
);
const apiConfig: ApiConfig = createApiTestConfig({
  databaseUrl: organizationSettingsQueryDatabaseUrl,
  rollbackRetentionLimit: 5,
});
const pool: Pool = createDatabasePool(organizationSettingsQueryDatabaseUrl);
const db: Database = createDatabase(pool);

describe('organization settings db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: organizationSettingsQueryDatabaseUrl,
    db,
    pool,
  });

  it('reads the default inherited rollback retention policy for new organizations', async (): Promise<void> => {
    await createOrganization();

    await expect(findOrganizationSettings('org_123')).resolves.toEqual({
      auditRetentionDays: null,
      auditRetentionMode: 'inherit',
      organizationId: 'org_123',
      rollbackRetentionLimit: null,
      rollbackRetentionMode: 'inherit',
    });
  });

  it('persists explicit rollback retention overrides', async (): Promise<void> => {
    await createOrganization();

    const updatedSettings: OrganizationSettingsRow = await updateOrganizationSettings({
      auditRetentionDays: null,
      auditRetentionMode: 'inherit',
      organizationId: 'org_123',
      rollbackRetentionLimit: 3,
      rollbackRetentionMode: 'keep_last',
    });

    expect(updatedSettings).toEqual({
      auditRetentionDays: null,
      auditRetentionMode: 'inherit',
      organizationId: 'org_123',
      rollbackRetentionLimit: 3,
      rollbackRetentionMode: 'keep_last',
    });
    await expect(findOrganizationSettings('org_123')).resolves.toEqual(updatedSettings);
  });
});

async function createOrganization(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
}
