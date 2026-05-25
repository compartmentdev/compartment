import { isApiBusinessError } from '../errors/api-business-error';
import { findActiveAuthenticationSessionById } from '../queries/authentication.query';
import type { AuthSessionActorRow } from '../queries/authentication.query.types';
import { normalizeCliLoginEmail } from './cli-login.service.helpers';
import type { CliBrowserLoginAttempt, CliLoginSessionActor } from './cli-login.service.types';
import {
  readBrowserCliLoginAttemptCookie,
  type BrowserCliLoginAttemptCookieValue,
} from './browser-cli-login-attempt-cookie.service';
import { completeCliLoginAttemptFromSession, startCliBrowserLogin } from './cli-login.service';

export type BrowserCliLoginCompletionResult = 'completed' | 'different_principal' | 'invalid' | 'missing';

export interface ActiveBrowserCliLoginAttemptReadResult {
  attempt: CliBrowserLoginAttempt;
  status: 'active';
}

export interface InvalidBrowserCliLoginAttemptReadResult {
  status: 'invalid';
}

export interface MissingBrowserCliLoginAttemptReadResult {
  status: 'missing';
}

export type BrowserCliLoginAttemptReadResult =
  | ActiveBrowserCliLoginAttemptReadResult
  | InvalidBrowserCliLoginAttemptReadResult
  | MissingBrowserCliLoginAttemptReadResult;

export async function readCliLoginAttemptFromBrowserCookie(
  cookieHeader: string | undefined,
): Promise<BrowserCliLoginAttemptReadResult> {
  const cliLoginAttempt: BrowserCliLoginAttemptCookieValue | undefined = readBrowserCliLoginAttemptCookie(cookieHeader);
  if (cliLoginAttempt === undefined) {
    return {
      status: 'missing',
    };
  }

  try {
    return {
      attempt: await startCliBrowserLogin(cliLoginAttempt),
      status: 'active',
    };
  } catch (error) {
    const businessError: Error | null = error instanceof Error ? error : null;
    if (isApiBusinessError(businessError) && businessError.code === 'invalid_cli_login') {
      return {
        status: 'invalid',
      };
    }

    throw error;
  }
}

export async function completeCliLoginAttemptFromBrowserSessionCookie(
  cookieHeader: string | undefined,
  session: CliLoginSessionActor,
): Promise<BrowserCliLoginCompletionResult> {
  const cliLoginAttempt: BrowserCliLoginAttemptCookieValue | undefined = readBrowserCliLoginAttemptCookie(cookieHeader);
  if (cliLoginAttempt === undefined) {
    return 'missing';
  }

  return await completeCliLoginAttemptFromCookieValue(cliLoginAttempt, session);
}

export async function readActiveCliLoginSessionActor(sessionId: string): Promise<CliLoginSessionActor | undefined> {
  const session: AuthSessionActorRow | undefined = await findActiveAuthenticationSessionById(sessionId);
  if (session?.principalType !== 'user') {
    return undefined;
  }

  return {
    authMethodKind: session.authMethodKind,
    oidcProviderId: session.oidcProviderId,
    organizationId: session.organizationId,
    principalEmail: session.principalEmail,
    principalId: session.principalId,
  };
}

async function completeCliLoginAttemptFromCookieValue(
  cliLoginAttempt: BrowserCliLoginAttemptCookieValue,
  session: CliLoginSessionActor,
): Promise<BrowserCliLoginCompletionResult> {
  try {
    const attempt: CliBrowserLoginAttempt = await startCliBrowserLogin({ ...cliLoginAttempt });
    if (
      attempt.expectedPrincipalEmail !== undefined &&
      isDifferentCliLoginPrincipal(session.principalEmail, attempt.expectedPrincipalEmail)
    ) {
      return 'different_principal';
    }
    await completeCliLoginAttemptFromSession({ ...cliLoginAttempt, session });
    return 'completed';
  } catch (error) {
    const businessError: Error | null = error instanceof Error ? error : null;
    if (isApiBusinessError(businessError) && businessError.code === 'invalid_cli_login') {
      return 'invalid';
    }

    throw error;
  }
}

function isDifferentCliLoginPrincipal(sessionEmail: string, expectedPrincipalEmail: string): boolean {
  return normalizeCliLoginEmail(sessionEmail) !== expectedPrincipalEmail;
}
