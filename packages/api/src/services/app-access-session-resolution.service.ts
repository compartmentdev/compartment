import type { AppAccessSessionState } from '@compartment/contracts';
import { hashToken } from '../lib/tokens';
import { findResolvedAppAccessSessionByTokenHash } from '../queries/app-access.query';
import type { ResolvedAppAccessSessionRow } from '../queries/app-access.query.types';
import { findActiveAuthenticationSessionById } from '../queries/authentication.query';
import type { AuthSessionActorRow } from '../queries/authentication.query.types';
import { getApiConfig } from '../runtime/runtime-access';

export async function resolveAppAccessSession(appSessionToken: string): Promise<AppAccessSessionState | null> {
  const appSession: ResolvedAppAccessSessionRow | undefined = await findResolvedAppAccessSessionByTokenHash(
    hashToken(appSessionToken, getApiConfig().sessionSecret),
  );
  if (appSession === undefined) {
    return null;
  }
  const authSession: AuthSessionActorRow | undefined = await findActiveAuthenticationSessionById(
    appSession.authSessionId,
  );
  if (authSession?.principalType !== 'user') {
    return null;
  }
  return {
    authSessionId: appSession.authSessionId,
    expiresAt: appSession.expiresAt.toISOString(),
    host: appSession.host,
    principalEmail: authSession.principalEmail,
    principalId: authSession.principalId,
    principalType: 'user',
  };
}
