import pg from 'pg';

import { readApiConfig, type ApiConfig } from '../config';

async function main(): Promise<void> {
  const config: ApiConfig = readApiConfig();
  const databaseName: string = await readDatabaseName(config.databaseUrl);
  process.stdout.write(`Connected to ${databaseName}.\n`);
}

async function readDatabaseName(connectionString: string): Promise<string> {
  const pool: pg.Pool = new pg.Pool({
    connectionString,
  });

  try {
    const result: pg.QueryResult<{ database_name: string }> = await pool.query(
      'select current_database() as database_name',
    );
    const databaseName: string | undefined = result.rows[0]?.database_name;
    if (databaseName === undefined || databaseName === '') {
      throw new Error('Database check failed.');
    }
    return databaseName;
  } finally {
    await pool.end();
  }
}

void main();
