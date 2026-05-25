import type { ApiConfig } from '../config';
import { hashToken } from '../lib/tokens';
import { findAuthenticationSessionByTokenHash } from '../queries/authentication.query';
import type { AuthenticationSessionRow } from '../queries/authentication.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import type { Actor } from './auth-actor.types';

export async function authenticateSession(sessionToken: string): Promise<Actor | null> {
  const config: ApiConfig = getApiConfig();
  const tokenHash: string = hashToken(sessionToken, config.sessionSecret);
  const actor: AuthenticationSessionRow | undefined = await findAuthenticationSessionByTokenHash(tokenHash);
  if (actor?.principalType !== 'user') {
    return null;
  }

  return {
    authSession: {
      authMethodKind: actor.authMethodKind,
      oidcProviderId: actor.oidcProviderId,
      organizationId: actor.organizationId,
      principalId: actor.principalId,
    },
    principalId: actor.principalId,
    principalEmail: actor.principalEmail,
    principalType: 'user',
    sessionId: actor.sessionId,
    tokenHash,
  };
}
