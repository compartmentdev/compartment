import { buildFastifyResponseSchemas } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import {
  browserLoginCliCompletedPathname,
  browserLoginCliPathname,
  browserLoginPathname,
  browserLoginSsoCallbackPathname,
  browserLoginSsoPathname,
} from '../../browser-public-paths';
import { isApiBusinessError } from '../../errors/api-business-error';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import {
  createBrowserCliLoginAttemptCookie,
  createClearedBrowserCliLoginAttemptCookie,
} from '../../services/browser-cli-login-attempt-cookie.service';
import { createBrowserCsrfCookie } from '../../services/browser-csrf-cookie.service';
import { createCompartmentSessionCookie } from '../../services/browser-session-cookie.service';
import {
  readCliLoginAttemptFromBrowserCookie,
  type BrowserCliLoginAttemptReadResult,
} from '../../services/browser-cli-login-flow.service';
import { failCliLoginAttempt, startCliBrowserLogin } from '../../services/cli-login.service';
import type { CliBrowserLoginAttempt } from '../../services/cli-login.service.types';
import {
  completeBrowserSsoLogin,
  findCliLoginAttemptIdForBrowserSsoCallback,
  startBrowserSsoLogin,
} from '../../services/sso-oidc/sso-oidc-login.service';
import type { CompleteSsoOidcLoginResult } from '../../services/sso-oidc/sso-oidc.service.types';
import { authRateLimitRouteOptions } from '../auth/auth-rate-limit.route';
import { browserNoReferrerPolicy } from './browser-anti-framing.headers';
import {
  buildCliLoginCompletedUrl,
  buildCliLoginStartResponseBody,
  renderCliLoginCompletedPage,
  renderCliLoginStartPage,
} from './browser-cli-login.page';
import type { BrowserFlowTargetOrNull, BrowserSsoQuery } from './browser-flow.types';
import { browserSsoQuerySchema, readFlowTarget } from './browser-flow.helpers';
import { buildSsoErrorLoginUrl } from './browser-login-error-redirect';
import { buildCurrentBrowserUrl } from './browser-login-response.helpers';
import { renderBrowserLoginPage } from './browser-login.page';
import { assertSafeBrowserSsoRedirectUrl } from './browser-sso-redirect-url.helpers';
import {
  readSelectedBrowserSessionOrganizationSlug,
  sendBrowserSessionRedirect,
} from './browser-session-response.helpers';
import {
  type BrowserCliCompletedQuery,
  type BrowserCliStartBody,
  browserCliCompletedQuerySchema,
  browserCliQuerySchema,
  browserCliStartBodySchema,
  browserCliStartResponseSchema,
} from './browser-login.route.schemas';

export function registerBrowserLoginRoute(app: ApiApp): void {
  registerRateLimitedGet(app, browserLoginPathname, handleBrowserLoginGet);
  registerRateLimitedGet(app, browserLoginSsoPathname, handleBrowserSsoLoginGet);
  registerRateLimitedGet(app, browserLoginCliPathname, handleBrowserCliLoginGet);
  registerRateLimitedGet(app, browserLoginCliCompletedPathname, handleBrowserCliCompletedGet);
  app.post(
    browserLoginCliPathname,
    {
      ...authRateLimitRouteOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: browserCliStartResponseSchema,
        }),
      },
    },
    handleBrowserCliLoginPost,
  );
  registerRateLimitedGet(app, browserLoginSsoCallbackPathname, handleBrowserSsoCallbackGet);
}

function registerRateLimitedGet(app: ApiApp, path: string, handler: BrowserLoginRouteHandler): void {
  app.get(path, authRateLimitRouteOptions, handler);
}

type BrowserLoginRouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;

async function handleBrowserLoginGet(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  reply.header('Set-Cookie', createBrowserCsrfCookie());

  return await reply.code(200).type('text/html; charset=utf-8').send(renderBrowserLoginPage());
}

async function handleBrowserSsoLoginGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const query: BrowserSsoQuery = parseRequestValue(browserSsoQuerySchema, request.query, 'invalid_browser_login_query');
  const flowTarget: BrowserFlowTargetOrNull = readFlowTarget(query);

  try {
    const cliAttempt: CliBrowserLoginAttempt | undefined = await readCliAttemptForBrowserSso(request, reply);
    const redirectUrl: string = await startBrowserSsoLogin({
      cliLoginAttemptId: cliAttempt?.id,
      flowTarget,
      providerId: query.provider,
    });
    assertSafeBrowserSsoRedirectUrl(redirectUrl);

    return await reply.redirect(redirectUrl);
  } catch (error) {
    const businessError: Error | null = error instanceof Error ? error : null;
    if (!isApiBusinessError(businessError)) {
      throw error;
    }

    return await sendSsoErrorRedirect(reply, flowTarget, query.successRedirectTo);
  }
}

async function handleBrowserCliLoginGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  parseRequestValue(browserCliQuerySchema, request.query, 'invalid_browser_login_query');
  reply.header('Referrer-Policy', browserNoReferrerPolicy);

  return await reply
    .code(200)
    .type('text/html; charset=utf-8')
    .send(renderCliLoginStartPage(buildSsoErrorLoginUrl(null)));
}

async function handleBrowserCliCompletedGet(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const query: BrowserCliCompletedQuery = parseRequestValue(
    browserCliCompletedQuerySchema,
    _request.query,
    'invalid_browser_login_query',
  );
  reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());

  return await reply
    .code(200)
    .type('text/html; charset=utf-8')
    .send(renderCliLoginCompletedPage(query.status === 'failed' ? 'failed' : 'success'));
}

async function handleBrowserCliLoginPost(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const body: BrowserCliStartBody = parseRequestValue(
    browserCliStartBodySchema,
    request.body,
    'invalid_browser_login_query',
  );

  try {
    return await sendBrowserCliLoginStartResponse(reply, body);
  } catch (error) {
    if (!isApiBusinessError(error as Error)) {
      throw error;
    }

    return await reply.code(400).send(
      browserCliStartResponseSchema.parse({
        loginUrl: buildSsoErrorLoginUrl(null),
      }),
    );
  }
}

async function handleBrowserSsoCallbackGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  try {
    return await sendBrowserSsoCallbackResult(reply, await completeBrowserSsoLogin(buildCurrentBrowserUrl(request)));
  } catch (error) {
    const businessError: Error | null = error instanceof Error ? error : null;
    if (await sendFailedCliSsoCallbackResult(request, reply, businessError)) {
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

async function sendFailedCliSsoCallbackResult(
  request: FastifyRequest,
  reply: FastifyReply,
  businessError: Error | null,
): Promise<boolean> {
  if (!isApiBusinessError(businessError)) {
    return false;
  }

  const cliLoginAttemptId: string | undefined = await findCliLoginAttemptIdForBrowserSsoCallback(
    buildCurrentBrowserUrl(request),
  );
  if (cliLoginAttemptId === undefined) {
    return false;
  }

  await failCliLoginAttempt(cliLoginAttemptId);
  await sendFailedCliCompletionRedirect(reply);
  return true;
}

async function sendBrowserCliLoginStartResponse(reply: FastifyReply, body: BrowserCliStartBody): Promise<FastifyReply> {
  const attempt: CliBrowserLoginAttempt = await startCliBrowserLogin({
    attemptId: body.attempt,
    browserCode: body.code,
  });
  reply.header('Referrer-Policy', browserNoReferrerPolicy);
  reply.header('Set-Cookie', createBrowserCliLoginAttemptCookie(body.attempt, body.code, attempt.expiresAt));

  return await reply.send(
    browserCliStartResponseSchema.parse(buildCliLoginStartResponseBody(attempt.organizationSlug)),
  );
}

async function readCliAttemptForBrowserSso(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<CliBrowserLoginAttempt | undefined> {
  const cliAttemptReadResult: BrowserCliLoginAttemptReadResult = await readCliLoginAttemptFromBrowserCookie(
    request.headers.cookie,
  );
  if (cliAttemptReadResult.status === 'invalid') {
    reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());
    return undefined;
  }

  if (cliAttemptReadResult.status === 'missing') {
    return undefined;
  }

  return cliAttemptReadResult.attempt;
}

async function sendBrowserSsoCallbackResult(
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

async function sendSsoErrorRedirect(
  reply: FastifyReply,
  flowTarget: BrowserFlowTargetOrNull,
  successRedirectTo?: string,
): Promise<FastifyReply> {
  reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());
  return await reply.redirect(buildSsoErrorLoginUrl(flowTarget, successRedirectTo));
}

async function sendFailedCliCompletionRedirect(reply: FastifyReply): Promise<FastifyReply> {
  reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());
  return await reply.redirect(buildCliLoginCompletedUrl('failed'));
}

function isInvalidCliLoginBusinessError(error: Error | null | undefined): boolean {
  return isApiBusinessError(error) && error.code === 'invalid_cli_login';
}
