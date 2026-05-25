import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { readApiConfig } from '../config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export function createDatabasePool(connectionString: string = readApiConfig().databaseUrl): Pool {
  return new Pool({
    connectionString,
  });
}
export function createDatabase(pool: Pool): Database {
  return drizzle(pool, {
    schema,
  });
}
