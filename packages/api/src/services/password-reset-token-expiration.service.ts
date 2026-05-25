import argon2 from 'argon2';
import type { PrincipalCredentialRow } from '../queries/organization-users.query.types';
import { findPrincipalCredentialByEmailWithExecutor } from '../queries/principal-credentials.query';
import { getApiDatabase } from '../runtime/runtime-access';

export async function readPasswordResetTokenExpiresAt(
  email: string | undefined,
  resetToken: string,
): Promise<Date | undefined> {
  if (email === undefined) {
    return undefined;
  }

  const principal: PrincipalCredentialRow | undefined = await findPrincipalCredentialByEmailWithExecutor(
    getApiDatabase(),
    email,
  );
  if (!isPasswordResetTokenCandidate(principal)) {
    return undefined;
  }
  if (!(await argon2.verify(principal.passwordResetTokenHash, resetToken))) {
    return undefined;
  }

  return principal.passwordResetTokenExpiresAt;
}

function isPasswordResetTokenCandidate(
  principal: PrincipalCredentialRow | undefined,
): principal is PrincipalCredentialRow & {
  passwordResetTokenExpiresAt: Date;
  passwordResetTokenHash: string;
} {
  return (
    principal?.principalType === 'user' &&
    principal.credentialPrincipalId !== null &&
    principal.passwordHash !== null &&
    principal.passwordResetTokenHash !== null &&
    principal.passwordResetTokenExpiresAt !== null &&
    principal.passwordResetTokenExpiresAt > new Date()
  );
}
