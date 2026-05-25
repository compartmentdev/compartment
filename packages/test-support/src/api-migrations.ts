import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export async function runCompartmentApiMigrations(connectionString: string): Promise<void> {
  const pool: Pool = new Pool({
    connectionString,
  });

  try {
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(__dirname, '../../api/drizzle'),
    });
  } finally {
    await pool.end();
  }
}
