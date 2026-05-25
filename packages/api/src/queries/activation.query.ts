import { and, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { localCredentials, organizationMemberships, organizations, principals } from '../db/schema';
import { countActiveOrganizationMembershipsForPrincipalWithExecutor } from './organization-memberships.query';
import type { RbacTransaction } from './rbac.query.types';
import type { FinalizeLocalActivationInput, PrincipalCredentialRow } from './organization-users.query.types';
import {
  findPrincipalCredentialByEmailWithExecutor,
  principalCredentialSelection,
} from './principal-credentials.query';

export async function findActivatablePrincipalCredentialByEmailWithExecutor(
  executor: RbacTransaction,
  email: string,
): Promise<PrincipalCredentialRow | undefined> {
  const principal: PrincipalCredentialRow | undefined = await findPrincipalCredentialByEmailWithExecutor(
    executor,
    email,
  );

  if (principal === undefined) {
    return undefined;
  }

  const membershipCount: number = await countActiveOrganizationMembershipsForPrincipalWithExecutor(
    executor,
    principal.principalId,
  );

  return membershipCount > 0 ? principal : undefined;
}

export async function findPrincipalCredentialByBootstrapTokenHashWithExecutor(
  executor: ActivationQueryExecutor,
  tokenHash: string,
): Promise<PrincipalCredentialRow | undefined> {
  const rows: PrincipalCredentialRow[] = await executor
    .select(principalCredentialSelection)
    .from(principals)
    .innerJoin(localCredentials, eq(localCredentials.principalId, principals.id))
    .where(eq(localCredentials.bootstrapTokenHash, tokenHash))
    .limit(1);

  return rows[0];
}

export async function finalizeLocalActivationWithExecutor(
  executor: RbacTransaction,
  input: FinalizeLocalActivationInput,
): Promise<boolean> {
  const rows: { principalId: string }[] = await executor
    .update(localCredentials)
    .set({
      bootstrapTokenExpiresAt: null,
      bootstrapTokenHash: null,
      passwordHash: input.passwordHash,
      updatedAt: input.updatedAt,
    })
    .where(
      and(
        eq(localCredentials.principalId, input.principalId),
        eq(localCredentials.bootstrapTokenHash, input.bootstrapTokenHash),
        gt(localCredentials.bootstrapTokenExpiresAt, input.updatedAt),
        isNull(localCredentials.passwordHash),
        buildPrincipalCanActivateInOrganizationFilter(localCredentials.principalId, input.organizationId),
      ),
    )
    .returning(finalizeLocalActivationSelection);

  return rows.length === 1;
}

function buildPrincipalCanActivateInOrganizationFilter(
  principalId: typeof localCredentials.principalId,
  organizationId: string,
): SQL {
  return sql`exists (
    select 1
    from ${organizationMemberships}
    inner join ${organizations}
      on ${organizations.id} = ${organizationMemberships.organizationId}
    where ${organizationMemberships.principalId} = ${principalId}
      and ${organizationMemberships.organizationId} = ${organizationId}
      and ${organizationMemberships.blockedAt} is null
      and ${organizations.localPasswordEnabled} = true
  )`;
}

const finalizeLocalActivationSelection: {
  principalId: typeof localCredentials.principalId;
} = {
  principalId: localCredentials.principalId,
};

type ActivationQueryExecutor = Database | RbacTransaction;
