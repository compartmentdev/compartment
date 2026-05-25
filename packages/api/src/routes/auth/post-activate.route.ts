import {
  buildFastifyResponseSchemas,
  activateRequestSchema,
  activateResponseSchema,
  type ActivateRequest,
  type ActivateResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { isApiBusinessError } from '../../errors/api-business-error';
import { assertValidBrowserMutationRequest } from '../../http/browser-mutation-request';
import { parseRequestValue } from '../../http/validation';
import {
  clearSuccessfulActivationThrottle,
  readActivationThrottleBlock,
  recordFailedActivationAttempt,
} from '../../services/activation-throttle.service';
import { activateLocalUser } from '../../services/activation.service';
import type { ActivateLocalUserResult } from '../../services/activation.service.types';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import {
  consumeBrowserAuthTokenFlow,
  readBrowserAuthTokenFlowToken,
} from '../../services/browser-auth-token-flow.service';
import {
  createClearedBrowserActivateFlowCookie,
  createClearedLegacyBrowserActivateTokenCookie,
  readBrowserActivateFlowCookie,
} from '../../services/browser-activate-flow-cookie.service';
import { createCompartmentSessionCookie } from '../../services/browser-session-cookie.service';
import { readFlowTarget } from '../browser/browser-flow.helpers';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { resolveCookieAppFlowTarget } from './auth-app-flow-target.helpers';
import { authApiActivatePathname } from './auth-api-paths';
import { createAuthActivationRateLimitRouteOptions, type AuthRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildAuthSessionResponseFields } from './auth-session-response.helpers';
import { assertAuthThrottleAllowed, runWithAuthThrottleTracking } from './auth-throttle-route.helpers';
import { createActivationThrottleExceededError } from './auth-throttle-boundary-error';
import {
  readRequiredAuthToken,
  resolveAuthSessionDelivery,
  type ResolvedAuthSessionDelivery,
  usesSessionCookie,
} from './auth-token-input.helpers';
import type { ReadActivateRequestResult } from './post-activate.route.types';

export function registerPostActivateRoute(app: ApiApp): void {
  const routeOptions: AuthRateLimitRouteOptions = createAuthActivationRateLimitRouteOptions();

  app.post(
    authApiActivatePathname,
    {
      ...routeOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: activateResponseSchema,
        }),
      },
    },
    handlePostActivate,
  );
}

async function handlePostActivate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const activationRequest: ReadActivateRequestResult = readActivateRequest(request);
  const result: ActivateLocalUserResult = await activateWithThrottleTracking(activationRequest, request);
  return await sendActivateResponse(
    reply,
    activationRequest.requestBody,
    activationRequest.browserFlowId,
    activationRequest.sessionDelivery,
    result,
  );
}

function readActivateRequest(request: FastifyRequest): ReadActivateRequestResult {
  const requestBody: ActivateRequest = parseRequestValue(
    activateRequestSchema,
    request.body,
    'invalid_activate_request',
  );
  const sessionDelivery: ResolvedAuthSessionDelivery = resolveAuthSessionDelivery(requestBody.sessionDelivery);
  const browserFlowId: string | undefined =
    usesSessionCookie(sessionDelivery) && requestBody.bootstrapToken === undefined
      ? readBrowserActivateFlowCookie(request.headers.cookie)
      : undefined;
  if (usesSessionCookie(sessionDelivery)) {
    assertValidBrowserMutationRequest(request);
  }

  return {
    browserFlowId,
    requestBody,
    sessionDelivery,
  };
}

async function activateWithThrottleTracking(
  activationRequest: ReadActivateRequestResult,
  request: FastifyRequest,
): Promise<ActivateLocalUserResult> {
  const requestBody: ActivateRequest = activationRequest.requestBody;

  assertAuthThrottleAllowed(
    await readActivationThrottleBlock(requestBody.email, request.ip),
    createActivationThrottleExceededError,
  );

  return await runWithAuthThrottleTracking(request, {
    clearSuccess: async (): Promise<void> => await clearSuccessfulActivationThrottle(requestBody.email, request.ip),
    clearSuccessFailureMessage: 'Failed to clear activation throttle state after successful activation.',
    isCountedFailure: isInvalidBootstrapTokenError,
    recordCountedFailure: async (): Promise<void> => await recordFailedActivationAttempt(requestBody.email, request.ip),
    recordCountedFailureMessage: 'Failed to record activation throttle state after invalid bootstrap token.',
    run: async (): Promise<ActivateLocalUserResult> =>
      await runActivateLocalUser(requestBody, activationRequest, request),
  });
}

async function runActivateLocalUser(
  requestBody: ActivateRequest,
  activationRequest: ReadActivateRequestResult,
  request: FastifyRequest,
): Promise<ActivateLocalUserResult> {
  const result: ActivateLocalUserResult = await activateLocalUser({
    bootstrapToken: await readRequiredBootstrapToken(requestBody, activationRequest, request),
    email: requestBody.email,
    password: requestBody.password,
  });
  if (activationRequest.browserFlowId !== undefined) {
    await consumeBrowserAuthTokenFlow('activation', activationRequest.browserFlowId);
  }
  return result;
}

async function sendActivateResponse(
  reply: FastifyReply,
  requestBody: ActivateRequest,
  browserFlowId: string | undefined,
  sessionDelivery: ResolvedAuthSessionDelivery,
  result: ActivateLocalUserResult,
): Promise<FastifyReply> {
  const flowTarget: BrowserFlowTargetOrNull = readFlowTarget(requestBody);
  const response: ActivateResponse = await buildActivateResponse(
    sessionDelivery,
    result,
    await resolveActivateFlowTarget(sessionDelivery, flowTarget, result.sessionId),
  );
  if (usesSessionCookie(sessionDelivery)) {
    setActivateSessionCookies(reply, result, browserFlowId !== undefined);
  }

  return await reply.send(response);
}

async function readRequiredBootstrapToken(
  requestBody: ActivateRequest,
  activationRequest: ReadActivateRequestResult,
  request: FastifyRequest,
): Promise<string> {
  return await readRequiredAuthToken({
    cookieHeader: request.headers.cookie,
    errorCode: 'missing_activation_token',
    errorMessage: 'Activation token is required.',
    readCookieToken: async (): Promise<string | undefined> =>
      await readBrowserAuthTokenFlowToken('activation', activationRequest.browserFlowId),
    sessionDelivery: activationRequest.sessionDelivery,
    tokenFromBody: requestBody.bootstrapToken,
  });
}

function isInvalidBootstrapTokenError(error: Error): boolean {
  return isApiBusinessError(error) && error.code === 'invalid_bootstrap_token';
}

async function buildActivateResponse(
  sessionDelivery: ResolvedAuthSessionDelivery,
  result: ActivateLocalUserResult,
  flowTarget: BrowserFlowTargetOrNull,
): Promise<ActivateResponse> {
  return activateResponseSchema.parse(
    await buildAuthSessionResponseFields({
      flowTarget,
      result,
      sessionDelivery,
    }),
  );
}

async function resolveActivateFlowTarget(
  sessionDelivery: ResolvedAuthSessionDelivery,
  flowTarget: BrowserFlowTargetOrNull,
  sessionId: string,
): Promise<BrowserFlowTargetOrNull> {
  return await resolveCookieAppFlowTarget(sessionDelivery, flowTarget, sessionId);
}

function setActivateSessionCookies(
  reply: FastifyReply,
  result: ActivateLocalUserResult,
  shouldClearBrowserFlow: boolean,
): void {
  const cookies: string[] = [createClearedLegacyBrowserActivateTokenCookie()];
  if (shouldClearBrowserFlow) {
    cookies.push(createClearedBrowserActivateFlowCookie());
  }
  cookies.push(createCompartmentSessionCookie(result.sessionToken, result.sessionExpiresAt));
  reply.header('Set-Cookie', cookies);
}
