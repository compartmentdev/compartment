import { sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';

export async function lockResourceRuntimeClaims(
  transaction: ApiDatabaseTransaction,
  resourceIds: string[],
): Promise<void> {
  const orderedIds: string[] = [...new Set(resourceIds)].sort((left: string, right: string): number =>
    left.localeCompare(right),
  );
  if (orderedIds.length === 0) {
    return;
  }
  const rows: SQL[] = orderedIds.map((resourceId: string): SQL => sql`(${resourceId})`);
  await transaction.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(resource_id, 83017))
    from (values ${sql.join(rows, sql`, `)}) as resources(resource_id)
    order by resource_id
  `);
}
