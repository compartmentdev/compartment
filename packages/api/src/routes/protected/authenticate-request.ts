import { compartmentSessionCookieName } from '@compartment/contracts';
import { hasText, readCookieValue, readHeaderValue } from '@compartment/utils';
import type { FastifyRequest } from 'fastify';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { assertValidBrowserMutationRequest } from '../../http/browser-mutation-request';
import { requireBearerToken } from '../../http/headers';
import '../../http/request.types';
import type { Actor } from '../../services/auth-actor.types';
import { authenticateSession } from '../../services/authentication.service';

export async function authenticateRequest(request: FastifyRequest): Promise<void> {
  const bearerToken: string | undefined = readOptionalBearerToken(readHeaderValue(request.headers.authorization));
  const sessionToken: string | undefined =
    bearerToken ?? readCookieValue(request.headers.cookie, compartmentSessionCookieName);
  if (!hasText(sessionToken)) {
    throw createUnauthorizedError();
  }

  const actor: Actor | null = await authenticateSession(sessionToken);

  if (!actor) {
    throw createUnauthorizedError();
  }
  if (bearerToken === undefined) {
    authenticateBrowserCookieRequest(request);
  }

  request.actor = actor;
  request.authTransport = bearerToken === undefined ? 'browser_cookie' : 'bearer';
}

function readOptionalBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!hasText(authorizationHeader)) {
    return undefined;
  }

  return requireBearerToken(authorizationHeader, 'unauthorized', 'A valid session is required.');
}

function authenticateBrowserCookieRequest(request: FastifyRequest): void {
  if (isSafeRequestMethod(request.method)) {
    return;
  }

  assertValidBrowserMutationRequest(request);
}

function isSafeRequestMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function createUnauthorizedError(): ApiBoundaryError {
  return new ApiBoundaryError(401, 'unauthorized', 'A valid session is required.');
}
