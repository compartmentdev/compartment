import { hashToken } from '../lib/tokens';
import { findPrincipalCredentialByBootstrapTokenHashWithExecutor } from '../queries/activation.query';
import type { PrincipalCredentialRow } from '../queries/organization-users.query.types';
import { getApiConfig, getApiDatabase } from '../runtime/runtime-access';
import {
  doesRequestedEmailMatchPrincipal,
  isBootstrapTokenValid,
  readPendingLocalActivation,
} from './activation-token.service.helpers';

export async function readActivationTokenExpiresAt(
  bootstrapToken: string,
  email: string | undefined,
): Promise<Date | undefined> {
  const tokenHash: string = hashToken(bootstrapToken, getApiConfig().sessionSecret);
  const principal: PrincipalCredentialRow | undefined = readPendingLocalActivation(
    await findPrincipalCredentialByBootstrapTokenHashWithExecutor(getApiDatabase(), tokenHash),
  );
  if (principal === undefined || !isBootstrapTokenValid(principal, tokenHash, new Date())) {
    return undefined;
  }
  if (email !== undefined && !doesRequestedEmailMatchPrincipal(email, principal.email)) {
    return undefined;
  }

  return principal.bootstrapTokenExpiresAt ?? undefined;
}
