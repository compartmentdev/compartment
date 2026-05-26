import type { FastifyReply } from 'fastify';
import { browserLoginCliCompletedPathname } from '../../browser-public-paths';
import { isApiBusinessError } from '../../errors/api-business-error';
import { createClearedBrowserCliLoginAttemptCookie } from '../../services/browser-cli-login-attempt-cookie.service';
import { createCompartmentSessionCookie } from '../../services/browser-session-cookie.service';
import { failCliLoginAttempt } from '../../services/cli-login.service';
import { findCliLoginAttemptIdForBrowserSsoCallback } from '../../services/sso-oidc/sso-oidc-login.service';
import type { CompleteSsoOidcLoginResult } from '../../services/sso-oidc/sso-oidc.service.types';
import type { BrowserFlowTargetOrNull } from './browser-flow.types';
import { buildSsoErrorLoginUrl } from './browser-login-error-redirect';
import { buildCliLoginCompletedUrl } from './browser-cli-login.page';
import {
  readSelectedBrowserSessionOrganizationSlug,
  sendBrowserSessionRedirect,
} from './browser-session-response.helpers';

export async function sendBrowserSsoCallbackResult(
  reply: FastifyReply,
  result: CompleteSsoOidcLoginResult,
): Promise<FastifyReply> {
  if (result.kind === 'cli_attempt_authenticated') {
    reply.header('Set-Cookie', [
      createCompartmentSessionCookie(result.sessionToken, result.sessionExpiresAt),
      createClearedBrowserCliLoginAttemptCookie(),
    ]);

    return await reply.redirect(browserLoginCliCompletedPathname);
  }

  return await sendBrowserSessionRedirect(reply, {
    flowTarget: result.flowTarget,
    selectedOrganizationSlug: readSelectedBrowserSessionOrganizationSlug({
      authSession: result.authSession,
      organizations: result.organizations,
    }),
    sessionExpiresAt: result.sessionExpiresAt,
    sessionId: result.sessionId,
    sessionToken: result.sessionToken,
  });
}

export async function sendBrowserSsoCallbackErrorResult(
  currentUrl: URL,
  reply: FastifyReply,
  businessError: Error,
): Promise<FastifyReply> {
  if (await sendFailedCliSsoCallbackResult(currentUrl, reply, businessError)) {
    return await reply;
  }
  if (isInvalidCliLoginBusinessError(businessError)) {
    return await sendFailedCliCompletionRedirect(reply);
  }
  if (!isApiBusinessError(businessError)) {
    throw businessError;
  }

  return await sendSsoErrorRedirect(reply, null);
}

export async function sendBrowserSsoFailureCallbackResult(currentUrl: URL, reply: FastifyReply): Promise<FastifyReply> {
  if (await sendFailedCliSsoCallbackResult(currentUrl, reply)) {
    return await reply;
  }

  return await sendSsoErrorRedirect(reply, null);
}

export async function sendSsoErrorRedirect(
  reply: FastifyReply,
  flowTarget: BrowserFlowTargetOrNull,
  successRedirectTo?: string,
): Promise<FastifyReply> {
  reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());
  return await reply.redirect(buildSsoErrorLoginUrl(flowTarget, successRedirectTo));
}

async function sendFailedCliSsoCallbackResult(
  currentUrl: URL,
  reply: FastifyReply,
  businessError?: Error,
): Promise<boolean> {
  if (businessError !== undefined && !isApiBusinessError(businessError)) {
    return false;
  }

  const cliLoginAttemptId: string | undefined = await findCliLoginAttemptIdForBrowserSsoCallback(currentUrl);
  if (cliLoginAttemptId === undefined) {
    return false;
  }

  await failCliLoginAttempt(cliLoginAttemptId);
  await sendFailedCliCompletionRedirect(reply);
  return true;
}

async function sendFailedCliCompletionRedirect(reply: FastifyReply): Promise<FastifyReply> {
  reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());
  return await reply.redirect(buildCliLoginCompletedUrl('failed'));
}

function isInvalidCliLoginBusinessError(error: Error): boolean {
  return isApiBusinessError(error) && error.code === 'invalid_cli_login';
}
