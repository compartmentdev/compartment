import {
  buildFastifyResponseSchemas,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  type ResetPasswordRequest,
  type ResetPasswordResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { isApiBusinessError } from '../../errors/api-business-error';
import { assertValidBrowserMutationRequest } from '../../http/browser-mutation-request';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { createCompartmentSessionCookie } from '../../services/browser-session-cookie.service';
import {
  consumeBrowserAuthTokenFlow,
  readBrowserAuthTokenFlowToken,
} from '../../services/browser-auth-token-flow.service';
import {
  createClearedBrowserResetPasswordFlowCookie,
  createClearedLegacyBrowserResetPasswordTokenCookie,
  readBrowserResetPasswordFlowCookie,
} from '../../services/browser-reset-password-flow-cookie.service';
import { resetPassword } from '../../services/password-reset.service';
import type { ResetPasswordResult } from '../../services/password-reset.service.types';
import {
  clearSuccessfulResetPasswordThrottle,
  readResetPasswordThrottleBlock,
  recordFailedResetPasswordAttempt,
} from '../../services/reset-password-throttle.service';
import { readFlowTarget } from '../browser/browser-flow.helpers';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { resolveCookieAppFlowTarget } from './auth-app-flow-target.helpers';
import { authApiResetPasswordPathname } from './auth-api-paths';
import { createAuthResetPasswordRateLimitRouteOptions, type AuthRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildAuthSessionResponseFields } from './auth-session-response.helpers';
import { assertAuthThrottleAllowed, runWithAuthThrottleTracking } from './auth-throttle-route.helpers';
import { createResetPasswordThrottleExceededError } from './auth-throttle-boundary-error';
import {
  readRequiredAuthToken,
  resolveAuthSessionDelivery,
  type ResolvedAuthSessionDelivery,
  usesSessionCookie,
} from './auth-token-input.helpers';
import type { ReadResetPasswordRequestResult } from './post-reset-password.route.types';

export function registerPostResetPasswordRoute(app: ApiApp): void {
  const routeOptions: AuthRateLimitRouteOptions = createAuthResetPasswordRateLimitRouteOptions();

  app.post(
    authApiResetPasswordPathname,
    {
      ...routeOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: resetPasswordResponseSchema,
        }),
      },
    },
    handlePostResetPassword,
  );
}

async function handlePostResetPassword(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const resetRequest: ReadResetPasswordRequestResult = readResetRequest(request);
  assertValidCookieResetPasswordRequest(request, resetRequest.sessionDelivery);
  assertAuthThrottleAllowed(
    await readResetPasswordThrottleBlock(resetRequest.requestBody.email, request.ip),
    createResetPasswordThrottleExceededError,
  );

  return await sendResetPasswordResponse(request, reply, resetRequest);
}

function readResetRequest(request: FastifyRequest): ReadResetPasswordRequestResult {
  const requestBody: ResetPasswordRequest = parseRequestValue(
    resetPasswordRequestSchema,
    request.body,
    'invalid_reset_password_request',
  );
  const sessionDelivery: ResolvedAuthSessionDelivery = resolveAuthSessionDelivery(requestBody.sessionDelivery);
  const browserFlowId: string | undefined =
    usesSessionCookie(sessionDelivery) && requestBody.resetToken === undefined
      ? readBrowserResetPasswordFlowCookie(request.headers.cookie)
      : undefined;

  return {
    browserFlowId,
    requestBody,
    sessionDelivery,
  };
}

function assertValidCookieResetPasswordRequest(
  request: FastifyRequest,
  sessionDelivery: ResolvedAuthSessionDelivery,
): void {
  if (usesSessionCookie(sessionDelivery)) {
    assertValidBrowserMutationRequest(request);
  }
}

async function sendResetPasswordResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  resetRequest: ReadResetPasswordRequestResult,
): Promise<FastifyReply> {
  const hasResetFlowCookie: boolean = resetRequest.browserFlowId !== undefined;

  try {
    return await reply.send(await createResetPasswordResponse(request, reply, resetRequest, hasResetFlowCookie));
  } catch (error) {
    if (error instanceof Error) {
      await clearInvalidResetTokenFlow(reply, resetRequest, error);
    }
    throw error;
  }
}

async function createResetPasswordResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  resetRequest: ReadResetPasswordRequestResult,
  hasResetFlowCookie: boolean,
): Promise<ResetPasswordResponse> {
  const requestBody: ResetPasswordRequest = resetRequest.requestBody;
  const sessionDelivery: ResolvedAuthSessionDelivery = resetRequest.sessionDelivery;
  const resetToken: string = await readRequiredResetToken(requestBody.resetToken, resetRequest, request.headers.cookie);
  const flowTarget: BrowserFlowTargetOrNull = readFlowTarget(requestBody);
  const result: ResetPasswordResult = await resetPasswordWithFailureTracking(requestBody, resetToken, request);
  const response: ResetPasswordResponse = resetPasswordResponseSchema.parse(
    await buildAuthSessionResponseFields({
      flowTarget: await resolveResetPasswordFlowTarget(sessionDelivery, flowTarget, result.sessionId),
      result,
      sessionDelivery,
    }),
  );

  if (resetRequest.browserFlowId !== undefined) {
    await consumeBrowserAuthTokenFlow('password_reset', resetRequest.browserFlowId);
  }
  setResetPasswordResponseCookies(reply, sessionDelivery, result, hasResetFlowCookie);
  return response;
}

async function resetPasswordWithFailureTracking(
  requestBody: ResetPasswordRequest,
  resetToken: string,
  request: FastifyRequest,
): Promise<ResetPasswordResult> {
  return await runWithAuthThrottleTracking(request, {
    clearSuccess: async (): Promise<void> => await clearSuccessfulResetPasswordThrottle(requestBody.email, request.ip),
    clearSuccessFailureMessage: 'Failed to clear reset password throttle state after successful password reset.',
    isCountedFailure: isInvalidPasswordResetTokenError,
    recordCountedFailure: async (): Promise<void> =>
      await recordFailedResetPasswordAttempt(requestBody.email, request.ip),
    recordCountedFailureMessage: 'Failed to record reset password throttle state after invalid reset token.',
    run: async (): Promise<ResetPasswordResult> =>
      await resetPassword(requestBody.email, requestBody.password, resetToken),
  });
}

function isInvalidPasswordResetTokenError(error: Error): boolean {
  return isApiBusinessError(error) && error.code === 'invalid_password_reset_token';
}

async function clearInvalidResetTokenFlow(
  reply: FastifyReply,
  resetRequest: ReadResetPasswordRequestResult,
  error: Error,
): Promise<void> {
  if (
    resetRequest.browserFlowId !== undefined &&
    isApiBusinessError(error) &&
    error.code === 'invalid_password_reset_token'
  ) {
    await consumeBrowserAuthTokenFlow('password_reset', resetRequest.browserFlowId);
    reply.header('Set-Cookie', createResetPasswordFlowClearCookies());
  }
}

async function readRequiredResetToken(
  resetTokenFromBody: string | undefined,
  resetRequest: ReadResetPasswordRequestResult,
  cookieHeader: string | undefined,
): Promise<string> {
  return await readRequiredAuthToken({
    cookieHeader,
    errorCode: 'missing_password_reset_token',
    errorMessage: 'Password reset token is required.',
    readCookieToken: async (): Promise<string | undefined> =>
      await readBrowserAuthTokenFlowToken('password_reset', resetRequest.browserFlowId),
    sessionDelivery: resetRequest.sessionDelivery,
    tokenFromBody: resetTokenFromBody,
  });
}

function setResetPasswordResponseCookies(
  reply: FastifyReply,
  sessionDelivery: ResolvedAuthSessionDelivery,
  result: ResetPasswordResult,
  hasResetFlowCookie: boolean,
): void {
  const cookies: string[] = [];
  if (hasResetFlowCookie) {
    cookies.push(createClearedBrowserResetPasswordFlowCookie());
  }
  if (usesSessionCookie(sessionDelivery)) {
    cookies.push(createClearedLegacyBrowserResetPasswordTokenCookie());
    cookies.push(createCompartmentSessionCookie(result.sessionToken, result.sessionExpiresAt));
  }
  if (cookies.length > 0) {
    reply.header('Set-Cookie', cookies);
  }
}

async function resolveResetPasswordFlowTarget(
  sessionDelivery: ResolvedAuthSessionDelivery,
  flowTarget: BrowserFlowTargetOrNull,
  sessionId: string,
): Promise<BrowserFlowTargetOrNull> {
  return await resolveCookieAppFlowTarget(sessionDelivery, flowTarget, sessionId);
}

function createResetPasswordFlowClearCookies(): string[] {
  return [createClearedLegacyBrowserResetPasswordTokenCookie(), createClearedBrowserResetPasswordFlowCookie()];
}
