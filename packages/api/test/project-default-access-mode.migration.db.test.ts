import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import type { Pool, QueryResult } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../src/db/client';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

interface MigratedProjectDefaultRow {
  columnDefault: string | null;
  defaultAccessMode: string;
}

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'project_default_access_mode_migration');
const pool: Pool = createDatabasePool(databaseUrl);

describe('project default access mode migration', (): void => {
  useApiDatabaseTestHarness(databaseUrl);

  afterAll(async (): Promise<void> => {
    await pool.end();
  });

  it('backfills existing projects without leaving a default for future inserts', async (): Promise<void> => {
    await pool.query('BEGIN');
    try {
      await pool.query('ALTER TABLE projects DROP COLUMN default_access_mode');
      await pool.query("INSERT INTO organizations (id, name, slug) VALUES ('org_existing', 'Existing', 'existing')");
      await pool.query(
        "INSERT INTO projects (id, organization_id, name) VALUES ('prj_existing', 'org_existing', 'existing')",
      );
      const migrationSql: string = await readFile(
        resolve(process.cwd(), 'packages/api/drizzle/0009_calm_franklin_storm.sql'),
        'utf8',
      );
      await pool.query(migrationSql);

      const result: QueryResult<MigratedProjectDefaultRow> = await pool.query<MigratedProjectDefaultRow>(`
        SELECT projects.default_access_mode AS "defaultAccessMode", columns.column_default AS "columnDefault"
        FROM projects
        CROSS JOIN information_schema.columns AS columns
        WHERE projects.id = 'prj_existing'
          AND columns.table_schema = 'public'
          AND columns.table_name = 'projects'
          AND columns.column_name = 'default_access_mode'
      `);
      expect(result.rows).toEqual([{ columnDefault: null, defaultAccessMode: 'authenticated' }]);
    } finally {
      await pool.query('ROLLBACK');
    }
  });
});
