import { and, eq, gt, sql, type SQL } from 'drizzle-orm';
import { localCredentials } from '../db/schema';
import type { OrganizationUsersTransaction } from './organization-users.query.types';
import type { CompletePasswordResetInput, SetPasswordResetTokenInput } from './password-reset.query.types';

export async function setPasswordResetTokenWithExecutor(
  executor: OrganizationUsersTransaction,
  input: SetPasswordResetTokenInput,
): Promise<void> {
  await executor
    .update(localCredentials)
    .set({
      passwordResetOrganizationId: input.passwordResetOrganizationId,
      passwordResetTokenExpiresAt: input.passwordResetTokenExpiresAt,
      passwordResetTokenHash: input.passwordResetTokenHash,
      updatedAt: input.updatedAt,
    })
    .where(eq(localCredentials.principalId, input.principalId));
}

export async function completePasswordResetWithExecutor(
  executor: OrganizationUsersTransaction,
  input: CompletePasswordResetInput,
): Promise<boolean> {
  const rows: { principalId: string }[] = await executor
    .update(localCredentials)
    .set({
      passwordHash: input.passwordHash,
      passwordResetOrganizationId: null,
      passwordResetTokenExpiresAt: null,
      passwordResetTokenHash: null,
      updatedAt: input.updatedAt,
    })
    .where(buildCompletePasswordResetFilter(input))
    .returning({
      principalId: localCredentials.principalId,
    });

  return rows.length === 1;
}

function buildCompletePasswordResetFilter(input: CompletePasswordResetInput): SQL {
  return and(
    eq(localCredentials.principalId, input.principalId),
    eq(localCredentials.passwordResetOrganizationId, input.passwordResetOrganizationId),
    eq(localCredentials.passwordResetTokenHash, input.passwordResetTokenHash),
    gt(localCredentials.passwordResetTokenExpiresAt, input.updatedAt),
  )!;
}

export async function lockPasswordResetCredentialRowWithExecutor(
  executor: OrganizationUsersTransaction,
  principalId: string,
): Promise<void> {
  await executor.execute(
    sql`select ${localCredentials.principalId} from ${localCredentials} where ${localCredentials.principalId} = ${principalId} for update`,
  );
}
