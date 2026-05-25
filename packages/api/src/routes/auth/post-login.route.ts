import {
  buildFastifyResponseSchemas,
  loginRequestSchema,
  loginResponseSchema,
  type LoginRequest,
  type LoginResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { isApiBusinessError } from '../../errors/api-business-error';
import { assertValidBrowserMutationRequest } from '../../http/browser-mutation-request';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import {
  completeCliLoginAttemptFromBrowserSessionCookie,
  readActiveCliLoginSessionActor,
  type BrowserCliLoginCompletionResult,
} from '../../services/browser-cli-login-flow.service';
import type { CliLoginSessionActor } from '../../services/cli-login.service.types';
import {
  createClearedBrowserCliLoginAttemptCookie,
  readBrowserCliLoginAttemptCookie,
} from '../../services/browser-cli-login-attempt-cookie.service';
import { createCompartmentSessionCookie } from '../../services/browser-session-cookie.service';
import { resolveBrowserLoginOrganizationId } from '../../services/browser-login-flow.service';
import {
  clearSuccessfulLoginThrottle,
  readLoginThrottleBlock,
  recordFailedLoginAttempt,
} from '../../services/login-throttle.service';
import { login, loginForOrganization } from '../../services/login.service';
import type { LoginServiceResult } from '../../services/login.service.types';
import { readFlowTarget } from '../browser/browser-flow.helpers';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { authApiLoginPathname } from './auth-api-paths';
import { createAuthLoginRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildAuthSessionResponseFields } from './auth-session-response.helpers';
import { assertAuthThrottleAllowed, runWithAuthThrottleTracking } from './auth-throttle-route.helpers';
import { createLoginThrottleExceededError } from './auth-throttle-boundary-error';
import { buildCliLoginCompletedUrl } from '../browser/browser-cli-login.page';
import { buildBrowserLoginGetUrl } from '../browser/browser-auth-get-url.helpers';
import {
  resolveAuthSessionDelivery,
  type ResolvedAuthSessionDelivery,
  usesSessionCookie,
} from './auth-token-input.helpers';

interface CliLoginCompletionResult {
  extraCookies?: string[] | undefined;
  redirectToOverride?: string | undefined;
}

export function registerPostLoginRoute(app: ApiApp): void {
  app.post(
    authApiLoginPathname,
    {
      ...createAuthLoginRateLimitRouteOptions(),
      schema: {
        response: buildFastifyResponseSchemas({
          200: loginResponseSchema,
        }),
      },
    },
    handlePostLogin,
  );
}

async function handlePostLogin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const requestBody: LoginRequest = parseRequestValue(loginRequestSchema, request.body, 'invalid_login_request');
  const sessionDelivery: ResolvedAuthSessionDelivery = resolveAuthSessionDelivery(requestBody.sessionDelivery);
  if (usesSessionCookie(sessionDelivery)) {
    assertValidBrowserMutationRequest(request);
  }
  const flowTarget: BrowserFlowTargetOrNull = readFlowTarget(requestBody);

  assertAuthThrottleAllowed(await readLoginThrottleBlock(requestBody, request.ip), createLoginThrottleExceededError);

  const result: LoginServiceResult = await runWithAuthThrottleTracking(request, {
    clearSuccess: async (): Promise<void> => await clearSuccessfulLoginThrottle(requestBody, request.ip),
    clearSuccessFailureMessage: 'Failed to clear login throttle state after successful authentication.',
    isCountedFailure: isInvalidCredentialsError,
    recordCountedFailure: async (): Promise<void> => await recordFailedLoginAttempt(requestBody, request.ip),
    recordCountedFailureMessage: 'Failed to record login throttle state after invalid credentials.',
    run: async (): Promise<LoginServiceResult> =>
      await loginWithRequestOrganization(requestBody, flowTarget, sessionDelivery),
  });
  const cliLoginCompletion: CliLoginCompletionResult = usesSessionCookie(sessionDelivery)
    ? await maybeCompleteCliLoginAttempt(request, result)
    : {};

  return await sendPostLoginResponse(reply, flowTarget, result, sessionDelivery, cliLoginCompletion);
}

async function loginWithRequestOrganization(
  requestBody: LoginRequest,
  flowTarget: BrowserFlowTargetOrNull,
  sessionDelivery: ResolvedAuthSessionDelivery,
): Promise<LoginServiceResult> {
  if (flowTarget === null && requestBody.organizationSlug === undefined && !usesSessionCookie(sessionDelivery)) {
    return await login({
      email: requestBody.email,
      password: requestBody.password,
    });
  }

  return await loginForOrganization({
    email: requestBody.email,
    organizationId: await resolveBrowserLoginOrganizationId(flowTarget, requestBody.organizationSlug),
    password: requestBody.password,
  });
}

function isInvalidCredentialsError(error: Error): boolean {
  return isApiBusinessError(error) && error.code === 'invalid_credentials';
}

async function maybeCompleteCliLoginAttempt(
  request: FastifyRequest,
  result: LoginServiceResult,
): Promise<CliLoginCompletionResult> {
  if (readBrowserCliLoginAttemptCookie(request.headers.cookie) === undefined) {
    return {};
  }

  const session: CliLoginSessionActor = await readCliLoginSessionActorOrThrow(result.sessionId);
  const completion: BrowserCliLoginCompletionResult = await completeCliLoginAttemptFromBrowserSessionCookie(
    request.headers.cookie,
    session,
  );

  return buildCliLoginCompletionResult(completion);
}

async function readCliLoginSessionActorOrThrow(sessionId: string): Promise<CliLoginSessionActor> {
  const session: CliLoginSessionActor | undefined = await readActiveCliLoginSessionActor(sessionId);
  if (session !== undefined) {
    return session;
  }

  throw new Error(`Expected active login session ${sessionId} for CLI completion.`);
}

function buildCliLoginCompletionResult(completion: BrowserCliLoginCompletionResult): CliLoginCompletionResult {
  if (completion === 'invalid') {
    return {
      extraCookies: [createClearedBrowserCliLoginAttemptCookie()],
      redirectToOverride: buildCliLoginCompletedUrl('failed'),
    };
  }
  if (completion === 'different_principal') {
    return {
      redirectToOverride: buildBrowserLoginGetUrl({ autoRedirect: false }),
    };
  }
  if (completion !== 'completed') {
    return {};
  }

  return {
    extraCookies: [createClearedBrowserCliLoginAttemptCookie()],
    redirectToOverride: buildCliLoginCompletedUrl(),
  };
}

async function sendPostLoginResponse(
  reply: FastifyReply,
  flowTarget: BrowserFlowTargetOrNull,
  result: LoginServiceResult,
  sessionDelivery: ResolvedAuthSessionDelivery,
  cliLoginCompletion: CliLoginCompletionResult,
): Promise<FastifyReply> {
  const response: LoginResponse = loginResponseSchema.parse(
    await buildAuthSessionResponseFields({
      flowTarget,
      redirectToOverride: cliLoginCompletion.redirectToOverride,
      result,
      sessionDelivery,
    }),
  );
  if (usesSessionCookie(sessionDelivery)) {
    const setCookies: string[] = [
      ...(cliLoginCompletion.extraCookies ?? []),
      createCompartmentSessionCookie(result.sessionToken, result.sessionExpiresAt),
    ];
    reply.header('Set-Cookie', setCookies.length === 1 ? setCookies[0] : setCookies);
  }

  return await reply.send(response);
}
