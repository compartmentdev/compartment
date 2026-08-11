import argon2 from 'argon2';
import { createAccountAlreadyClaimedError, createEmailTakenError } from '../errors/api-business-error';
import type { OrganizationUsersTransaction } from '../queries/organization-users.query.types';
import {
  claimLocalPasswordHashWithExecutor,
  updatePrincipalEmailWithExecutor,
} from '../queries/principal-credentials.query';
import { isUniqueConstraintError } from '../queries/query-error';
import { deleteSignupIdempotencyKeysForPrincipalWithExecutor } from '../queries/signup-idempotency.query';
import { getApiDatabase } from '../runtime/runtime-access';
import type { ClaimAccountInput } from './claim-account.service.types';

/**
 * Claiming ends the account's disposable life: a person now owns it and a password protects it. The signup idempotency
 * key goes with it, in the same transaction, because it would otherwise keep minting sessions that walk straight past
 * that password. Nothing is lost by dropping it — a key only exists to help a caller reach its first session, and
 * binding a password proves that already happened.
 */
export async function claimAccount(input: ClaimAccountInput): Promise<void> {
  const passwordHash: string = await argon2.hash(input.password);

  try {
    await getApiDatabase().transaction(
      async (tx: OrganizationUsersTransaction): Promise<void> => await applyAccountClaim(tx, input, passwordHash),
    );
  } catch (error) {
    if (isUniqueConstraintError(error as Error | undefined)) {
      throw createEmailTakenError();
    }

    throw error;
  }
}

async function applyAccountClaim(
  tx: OrganizationUsersTransaction,
  input: ClaimAccountInput,
  passwordHash: string,
): Promise<void> {
  const claimed: boolean = await claimLocalPasswordHashWithExecutor(tx, {
    passwordHash,
    principalId: input.principalId,
    updatedAt: new Date(),
  });
  if (!claimed) {
    throw createAccountAlreadyClaimedError();
  }

  await updatePrincipalEmailWithExecutor(tx, input.principalId, input.email);
  await deleteSignupIdempotencyKeysForPrincipalWithExecutor(tx, input.principalId);
}
