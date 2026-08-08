import type { Pool, QueryResult } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { createDatabasePool } from '../src/db/client';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

interface NamedSchemaObjectRow {
  name: string;
}

interface SchemaColumnRow {
  isNullable: string;
}

interface SchemaIndexRow {
  definition: string;
  name: string;
}

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'kubernetes_cutover_schema');
const pool: Pool = createDatabasePool(databaseUrl);

describe('Kubernetes cutover schema', (): void => {
  useApiDatabaseTestHarness(databaseUrl);

  afterAll(async (): Promise<void> => {
    await pool.end();
  });

  it('does not install the removed host runtime table or columns', async (): Promise<void> => {
    const removedTableName: string = ['no', 'des'].join('');
    const removedColumns: string[] = [
      'container_id',
      'draining_container_id',
      'draining_deployment_id',
      'draining_node_id',
      'drain_deadline_at',
      'hostname',
      'node_id',
      'restart_policy',
      'runtime_kind',
      'upstream_host',
      'upstream_port',
    ];
    const tableRows: QueryResult<NamedSchemaObjectRow> = await pool.query<NamedSchemaObjectRow>(
      `select table_name as name
       from information_schema.tables
       where table_schema = 'public' and table_name = $1`,
      [removedTableName],
    );
    const columnRows: QueryResult<NamedSchemaObjectRow> = await pool.query<NamedSchemaObjectRow>(
      `select column_name as name
       from information_schema.columns
       where table_schema = 'public' and column_name = any($1::text[])
       order by column_name`,
      [removedColumns],
    );

    expect(tableRows.rows).toEqual([]);
    expect(columnRows.rows).toEqual([]);
  });

  it('removes every product-log byte quota object', async (): Promise<void> => {
    const tableRows: QueryResult<NamedSchemaObjectRow> = await pool.query<NamedSchemaObjectRow>(
      `select table_name as name
       from information_schema.tables
       where table_schema = 'public' and table_name = 'product_log_store_quota'`,
    );
    const functionRows: QueryResult<NamedSchemaObjectRow> = await pool.query<NamedSchemaObjectRow>(
      `select proname as name from pg_proc where proname = 'decrement_product_log_store_usage'`,
    );
    const triggerRows: QueryResult<NamedSchemaObjectRow> = await pool.query<NamedSchemaObjectRow>(
      `select tgname as name from pg_trigger where tgname = 'deployment_product_logs_quota_delete'`,
    );

    expect(tableRows.rows).toEqual([]);
    expect(functionRows.rows).toEqual([]);
    expect(triggerRows.rows).toEqual([]);
  });

  it('indexes the per-app product-log retention window', async (): Promise<void> => {
    const columnRows: QueryResult<SchemaColumnRow> = await pool.query<SchemaColumnRow>(
      `select is_nullable as "isNullable"
       from information_schema.columns
       where table_name = 'deployment_product_logs' and column_name = 'app_key'`,
    );
    const indexRows: QueryResult<SchemaIndexRow> = await pool.query<SchemaIndexRow>(
      `select indexname as name, indexdef as definition
       from pg_indexes
       where schemaname = 'public' and indexname = 'deployment_product_logs_app_window_idx'`,
    );

    expect(columnRows.rows).toEqual([{ isNullable: 'NO' }]);
    expect(indexRows.rows).toHaveLength(1);
    expect(indexRows.rows[0]?.definition).toContain('app_key, occurred_at DESC');
    expect(indexRows.rows[0]?.definition).toContain('source_offset DESC');
  });

  it('indexes the globally serialized active resource reconcile order', async (): Promise<void> => {
    const indexRows: QueryResult<SchemaIndexRow> = await pool.query<SchemaIndexRow>(
      `select indexname as name, indexdef as definition
       from pg_indexes
       where schemaname = 'public' and indexname = 'resource_reconcile_runs_active_order_idx'`,
    );

    expect(indexRows.rows).toHaveLength(1);
    expect(indexRows.rows[0]?.definition).toContain('(created_at, id)');
    expect(indexRows.rows[0]?.definition).toContain('WHERE');
    expect(indexRows.rows[0]?.definition).toContain('bootstrap-pending');
    expect(indexRows.rows[0]?.definition).toContain('reconcile-pending');
    expect(indexRows.rows[0]?.definition).toContain('running');
  });
});
