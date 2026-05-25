import type { AuthSessionDelivery } from '@compartment/contracts';
import { ApiBoundaryError } from '../../errors/api-boundary-error';

type AuthTokenSessionDelivery = AuthSessionDelivery | undefined;
export type ResolvedAuthSessionDelivery = AuthSessionDelivery;

interface ReadRequiredAuthTokenInput {
  cookieHeader: string | undefined;
  errorCode: string;
  errorMessage: string;
  readCookieToken: (cookieHeader: string | undefined) => Promise<string | undefined> | string | undefined;
  sessionDelivery: ResolvedAuthSessionDelivery;
  tokenFromBody: string | undefined;
}

export async function readRequiredAuthToken(input: ReadRequiredAuthTokenInput): Promise<string> {
  const token: string | undefined = await readAuthToken(input);
  if (token === undefined) {
    throw new ApiBoundaryError(400, input.errorCode, input.errorMessage);
  }

  return token;
}

async function readAuthToken(input: ReadRequiredAuthTokenInput): Promise<string | undefined> {
  return input.tokenFromBody ?? (await readCookieToken(input));
}

async function readCookieToken(input: ReadRequiredAuthTokenInput): Promise<string | undefined> {
  if (!usesSessionCookie(input.sessionDelivery)) {
    return undefined;
  }

  return await input.readCookieToken(input.cookieHeader);
}

export function resolveAuthSessionDelivery(sessionDelivery: AuthTokenSessionDelivery): ResolvedAuthSessionDelivery {
  return sessionDelivery === 'cookie' ? 'cookie' : 'token';
}

export function usesSessionCookie(sessionDelivery: ResolvedAuthSessionDelivery): boolean {
  return sessionDelivery === 'cookie';
}
