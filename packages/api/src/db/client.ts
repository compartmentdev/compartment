import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { readApiConfig } from '../config';
import * as schema from './schema';

interface DatabasePoolAccess {
  $client: Pool;
  $resourceOperationClientPool: Pool;
}

export type Database = NodePgDatabase<typeof schema> & DatabasePoolAccess;
export function createDatabasePool(connectionString: string = readApiConfig().databaseUrl): Pool {
  return new Pool({
    connectionString,
  });
}
export function createDatabase(pool: Pool, resourceOperationClientPool: Pool = pool): Database {
  const database: NodePgDatabase<typeof schema> = drizzle(pool, {
    schema,
  });
  return Object.assign(database, { $client: pool, $resourceOperationClientPool: resourceOperationClientPool });
}
