import { Client, type QueryResult } from 'pg';
import { assertSafeDatabaseName, createMaintenanceDatabaseUrl } from './database-url';
import type { TestDatabaseMaintenanceSession } from './test-database-run.adapter.types';

interface AdvisoryLockRow {
  acquired: boolean;
}

interface DatabaseNameRow {
  datname: string;
}

class PostgresTestDatabaseMaintenanceSession implements TestDatabaseMaintenanceSession {
  readonly #client: Client;

  public constructor(client: Client) {
    this.#client = client;
  }

  public async acquireLock(lockName: string): Promise<void> {
    await this.#client.query('select pg_advisory_lock(hashtextextended($1, 0))', [lockName]);
  }

  public async tryAcquireLock(lockName: string): Promise<boolean> {
    const result: QueryResult<AdvisoryLockRow> = await this.#client.query<AdvisoryLockRow>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
      [lockName],
    );
    return result.rows[0]?.acquired === true;
  }

  public async releaseLock(lockName: string): Promise<void> {
    await this.#client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [lockName]);
  }

  public async listDatabaseNames(prefix: string): Promise<string[]> {
    const result: QueryResult<DatabaseNameRow> = await this.#client.query<DatabaseNameRow>(
      'select datname from pg_database where left(datname, length($1)) = $1 order by datname',
      [prefix],
    );
    return result.rows.map((row: DatabaseNameRow): string => row.datname);
  }

  public async dropDatabase(databaseName: string): Promise<void> {
    assertSafeDatabaseName(databaseName);
    await this.#client.query(`drop database "${databaseName}" with (force)`);
  }

  public async close(): Promise<void> {
    await this.#client.end();
  }
}

export async function openTestDatabaseMaintenanceSession(databaseUrl: string): Promise<TestDatabaseMaintenanceSession> {
  const client: Client = new Client({
    connectionString: createMaintenanceDatabaseUrl(databaseUrl),
  });
  await client.connect();
  return new PostgresTestDatabaseMaintenanceSession(client);
}
