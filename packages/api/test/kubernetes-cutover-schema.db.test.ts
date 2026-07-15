import type { Pool, QueryResult } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { createDatabasePool } from '../src/db/client';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

interface NamedSchemaObjectRow {
  name: string;
}

interface ProductLogQuotaRow {
  id: string;
  usedBytes: string;
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

  it('preserves the manual product-log quota objects in the squashed baseline', async (): Promise<void> => {
    const quotaRows: QueryResult<ProductLogQuotaRow> = await pool.query<ProductLogQuotaRow>(
      `select id, used_bytes::text as "usedBytes" from product_log_store_quota where id = 'global'`,
    );
    const functionRows: QueryResult<NamedSchemaObjectRow> = await pool.query<NamedSchemaObjectRow>(
      `select proname as name from pg_proc where proname = 'decrement_product_log_store_usage'`,
    );
    const triggerRows: QueryResult<NamedSchemaObjectRow> = await pool.query<NamedSchemaObjectRow>(
      `select tgname as name from pg_trigger where tgname = 'deployment_product_logs_quota_delete'`,
    );

    expect(quotaRows.rows).toEqual([{ id: 'global', usedBytes: '0' }]);
    expect(functionRows.rows).toEqual([{ name: 'decrement_product_log_store_usage' }]);
    expect(triggerRows.rows).toEqual([{ name: 'deployment_product_logs_quota_delete' }]);
  });
});
