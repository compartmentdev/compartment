import { and, eq, sql, type SQL } from 'drizzle-orm';
import { organizationMemberships, organizations } from '../db/schema';
import type {
  OrganizationUsersTransaction,
  RemoveOrganizationMembershipInput,
  UpdateOrganizationMembershipBlockInput,
} from './organization-users.query.types';

interface OrganizationMembershipMutationFilterInput {
  organizationId: string;
  principalId: string;
}

export async function updateOrganizationMembershipBlockWithExecutor(
  executor: OrganizationUsersTransaction,
  input: UpdateOrganizationMembershipBlockInput,
): Promise<void> {
  await executor
    .update(organizationMemberships)
    .set({
      blockedAt: input.blockedAt,
    })
    .where(buildOrganizationMembershipMutationFilter(input));
}

export async function removeOrganizationMembershipWithExecutor(
  executor: OrganizationUsersTransaction,
  input: RemoveOrganizationMembershipInput,
): Promise<void> {
  await executor.delete(organizationMemberships).where(buildOrganizationMembershipMutationFilter(input));
}

export async function lockOrganizationMembershipMutationWithExecutor(
  executor: OrganizationUsersTransaction,
  organizationId: string,
): Promise<void> {
  await executor.execute(
    sql`select ${organizations.id} from ${organizations} where ${organizations.id} = ${organizationId} for update`,
  );
}

function buildOrganizationMembershipMutationFilter(input: OrganizationMembershipMutationFilterInput): SQL {
  const filter: SQL | undefined = and(
    eq(organizationMemberships.principalId, input.principalId),
    eq(organizationMemberships.organizationId, input.organizationId),
  );

  if (filter === undefined) {
    throw new Error('Expected organization membership mutation filter.');
  }

  return filter;
}
