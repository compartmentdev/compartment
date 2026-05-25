import type { Database } from '../db/client';
import { eq, sql } from 'drizzle-orm';
import { localCredentials, principals } from '../db/schema';
import { buildPrincipalEmailLookup } from './principal-email.query.helpers';
import type { PrincipalCredentialSelection } from './principal-credentials.query.types';
import type { OrganizationUsersTransaction, PrincipalCredentialRow } from './organization-users.query.types';

export const principalCredentialSelection: PrincipalCredentialSelection = {
  bootstrapTokenExpiresAt: localCredentials.bootstrapTokenExpiresAt,
  bootstrapTokenHash: localCredentials.bootstrapTokenHash,
  credentialPrincipalId: localCredentials.principalId,
  email: principals.email,
  passwordHash: localCredentials.passwordHash,
  passwordResetOrganizationId: localCredentials.passwordResetOrganizationId,
  passwordResetTokenExpiresAt: localCredentials.passwordResetTokenExpiresAt,
  passwordResetTokenHash: localCredentials.passwordResetTokenHash,
  principalId: principals.id,
  principalType: principals.type,
};

export async function lockPrincipalByEmailWithExecutor(
  executor: OrganizationUsersTransaction,
  email: string,
): Promise<void> {
  await executor.execute(
    sql`select ${principals.id} from ${principals} where ${buildPrincipalEmailLookup(email)} for update`,
  );
}

export async function findPrincipalCredentialByEmailWithExecutor(
  executor: PrincipalCredentialsExecutor,
  email: string,
): Promise<PrincipalCredentialRow | undefined> {
  const rows: PrincipalCredentialRow[] = await executor
    .select(principalCredentialSelection)
    .from(principals)
    .leftJoin(localCredentials, eq(localCredentials.principalId, principals.id))
    .where(buildPrincipalEmailLookup(email))
    .limit(1);

  return rows[0];
}

export async function clearLocalCredentialStateByPrincipalIdWithExecutor(
  executor: OrganizationUsersTransaction,
  principalId: string,
  updatedAt: Date,
): Promise<void> {
  await executor
    .update(localCredentials)
    .set({
      bootstrapTokenExpiresAt: null,
      bootstrapTokenHash: null,
      passwordHash: null,
      passwordResetOrganizationId: null,
      passwordResetTokenExpiresAt: null,
      passwordResetTokenHash: null,
      updatedAt,
    })
    .where(eq(localCredentials.principalId, principalId));
}

type PrincipalCredentialsExecutor = Database | OrganizationUsersTransaction;
