import type { PrincipalCredentialRow } from '../queries/organization-users.query.types';

export function readPendingLocalActivation(
  principal: PrincipalCredentialRow | undefined,
): PrincipalCredentialRow | undefined {
  if (principal === undefined) {
    return undefined;
  }
  if (
    principal.principalType !== 'user' ||
    principal.bootstrapTokenHash === null ||
    principal.bootstrapTokenExpiresAt === null ||
    principal.passwordHash !== null
  ) {
    return undefined;
  }

  return principal;
}

export function isBootstrapTokenValid(principal: PrincipalCredentialRow, tokenHash: string, now: Date): boolean {
  if (principal.bootstrapTokenHash !== tokenHash || principal.bootstrapTokenExpiresAt === null) {
    return false;
  }

  return principal.bootstrapTokenExpiresAt > now;
}

export function doesRequestedEmailMatchPrincipal(email: string | undefined, principalEmail: string): boolean {
  return email?.toLowerCase() === principalEmail.toLowerCase();
}
