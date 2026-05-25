import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { createDatabase, createDatabasePool, type Database } from './client';
import { readRequiredDatabaseUrl } from './database-url';

export async function runMigrations(connectionString: string = readRequiredDatabaseUrl()): Promise<void> {
  const pool: Pool = createDatabasePool(connectionString);
  const db: Database = createDatabase(pool);
  try {
    await migrate(db, {
      migrationsFolder: resolve(__dirname, '../../drizzle'),
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void runMigrations();
}
