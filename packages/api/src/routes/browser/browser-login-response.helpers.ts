import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiConfig } from '../../config';
import { browserLoginCliCompletedPathname } from '../../browser-public-paths';
import { isApiBusinessError } from '../../errors/api-business-error';
import { getApiConfig } from '../../runtime/runtime-access';
import { createClearedBrowserCliLoginAttemptCookie } from '../../services/browser-cli-login-attempt-cookie.service';
import { createCompartmentSessionCookie } from '../../services/browser-session-cookie.service';
import { failCliLoginAttempt } from '../../services/cli-login.service';
import { buildRuntimePublicSettings } from '../../services/public-hosts.service';
import type { InstallationPublicSettings } from '../../services/public-hosts.service.types';
import { readSsoOidcCallbackKind, type SsoOidcCallbackKind } from '../../services/sso-oidc/sso-oidc-callback.service';
import {
  completeBrowserSsoLogin,
  findCliLoginAttemptIdForBrowserSsoCallback,
} from '../../services/sso-oidc/sso-oidc-login.service';
import type { CompleteSsoOidcLoginResult } from '../../services/sso-oidc/sso-oidc.service.types';
import { buildCliLoginCompletedUrl } from './browser-cli-login.page';
import type { BrowserFlowTargetOrNull } from './browser-flow.types';
import { buildSsoErrorLoginUrl } from './browser-login-error-redirect';
import {
  readSelectedBrowserSessionOrganizationSlug,
  sendBrowserSessionRedirect,
} from './browser-session-response.helpers';

export function buildCurrentBrowserUrl(request: FastifyRequest): URL {
  const config: ApiConfig = getApiConfig();
  const publicSettings: InstallationPublicSettings = buildRuntimePublicSettings(config);

  return new URL(request.url, `${publicSettings.compartmentUrl}/`);
}

export async function sendBrowserSsoCallbackResponse(currentUrl: URL, reply: FastifyReply): Promise<FastifyReply> {
  const callbackKind: SsoOidcCallbackKind | null = readSsoOidcCallbackKind(currentUrl);
  if (callbackKind === null) {
    return await sendSsoErrorRedirect(reply, null);
  }
  if (callbackKind === 'failure') {
    return await sendBrowserSsoFailureCallbackResponse(currentUrl, reply);
  }

  return await sendBrowserSsoSuccessCallbackResponse(currentUrl, reply);
}

async function sendBrowserSsoSuccessCallbackResponse(currentUrl: URL, reply: FastifyReply): Promise<FastifyReply> {
  try {
    return await sendBrowserSsoCompletionResponse(reply, await completeBrowserSsoLogin(currentUrl));
  } catch (error) {
    const businessError: Error | null = error instanceof Error ? error : null;
    if (await sendFailedCliSsoCallbackResponse(currentUrl, reply, businessError)) {
      return await reply;
    }
    if (isInvalidCliLoginBusinessError(businessError)) {
      return await sendFailedCliCompletionRedirect(reply);
    }
    if (!isApiBusinessError(businessError)) {
      throw error;
    }

    return await sendSsoErrorRedirect(reply, null);
  }
}

async function sendBrowserSsoFailureCallbackResponse(currentUrl: URL, reply: FastifyReply): Promise<FastifyReply> {
  if (await sendFailedCliSsoCallbackResponse(currentUrl, reply)) {
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

async function sendBrowserSsoCompletionResponse(
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

async function sendFailedCliSsoCallbackResponse(
  currentUrl: URL,
  reply: FastifyReply,
  businessError?: Error | null,
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

function isInvalidCliLoginBusinessError(error: Error | null | undefined): boolean {
  return isApiBusinessError(error) && error.code === 'invalid_cli_login';
}
