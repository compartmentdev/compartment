import { createInvalidPasswordResetTokenError } from '../errors/api-business-error';
import type { PrincipalCredentialRow } from '../queries/organization-users.query.types';

export function readStoredResetTokenHash(principal: PrincipalCredentialRow): string {
  if (principal.passwordResetTokenHash === null) {
    throw createInvalidPasswordResetTokenError();
  }

  return principal.passwordResetTokenHash;
}

export function readStoredResetOrganizationId(principal: PrincipalCredentialRow): string {
  if (principal.passwordResetOrganizationId === null) {
    throw createInvalidPasswordResetTokenError();
  }

  return principal.passwordResetOrganizationId;
}
