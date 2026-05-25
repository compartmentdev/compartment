import type { Database } from '../db/client';
import { organizationMemberships, principals } from '../db/schema';

export async function createPrincipalWithType(
  executor: Pick<Database, 'insert'>,
  input: { email: string; id: string; type: string },
): Promise<void> {
  await executor.insert(principals).values(input).onConflictDoNothing();
}

export async function createOrganizationMembership(
  executor: Pick<Database, 'insert'>,
  input: { id: string; organizationId: string; principalId: string },
): Promise<void> {
  await executor
    .insert(organizationMemberships)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      principalId: input.principalId,
    })
    .onConflictDoUpdate({
      set: {
        blockedAt: null,
      },
      target: [organizationMemberships.organizationId, organizationMemberships.principalId],
    });
}
