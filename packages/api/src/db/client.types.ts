import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

export type ApiDatabaseFullSchema = typeof schema;
export type ApiDatabaseSchema = ExtractTablesWithRelations<ApiDatabaseFullSchema>;
export type ApiDatabaseTransaction = NodePgTransaction<ApiDatabaseFullSchema, ApiDatabaseSchema>;
