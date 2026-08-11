import type { Database } from '../src/db/client';
import { organizationQuotaReconciliation, organizations } from '../src/db/schema';

export async function seedOrganizationWithReadyQuota(
  db: Database,
  organizationId: string,
  name: string,
  slug: string,
): Promise<void> {
  await db.insert(organizations).values({ id: organizationId, name, slug });
  await db.insert(organizationQuotaReconciliation).values({ organizationId, state: 'succeeded' });
}
