import { eq } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { projectResources } from '../db/schema';

export async function lockProjectResourceForReconcile(
  transaction: ApiDatabaseTransaction,
  resourceId: string,
): Promise<void> {
  await transaction
    .select({ id: projectResources.id })
    .from(projectResources)
    .where(eq(projectResources.id, resourceId))
    .for('no key update');
}
