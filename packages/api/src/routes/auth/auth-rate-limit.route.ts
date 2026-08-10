import type { ApiApp } from '../../app.types';
import type { ApiRouteThrottleConfig } from '../../auth-throttle-config.types';
import { createApiMultiRateLimitRouteOptions, createApiRateLimitRouteOptions } from '../../http/rate-limit';
import { apiRouteRateLimitPolicies } from '../../http/rate-limit-policies';
import type {
  ApiRateLimitKeyGenerator,
  ApiMultiRateLimitRouteOptions,
  ApiRateLimitPolicy,
  ApiRateLimitRouteOptions,
} from '../../http/rate-limit.types';
import { getApiConfig } from '../../runtime/runtime-access';
import {
  readCliLoginAttemptRateLimitKey,
  readLoginDiscoverySubjectRateLimitKey,
  readResetPasswordRateLimitKey,
  readScopedAuthRateLimitKey,
} from './auth-rate-limit-keys';

export type AuthRateLimitRouteOptions = ApiRateLimitRouteOptions;

export const authRateLimitRouteOptions: AuthRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.authState,
);

export const authSignupRateLimitRouteOptions: AuthRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.authSignup,
);

export const authClaimRateLimitRouteOptions: AuthRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.authClaim,
);

export function createAuthLoginDiscoveryRateLimitRouteOptions(app: ApiApp): ApiMultiRateLimitRouteOptions {
  return createApiMultiRateLimitRouteOptions(app, [
    {
      policy: apiRouteRateLimitPolicies.authLoginDiscoverySource,
    },
    {
      keyGenerator: readLoginDiscoverySubjectRateLimitKey,
      policy: apiRouteRateLimitPolicies.authLoginDiscoverySubject,
    },
  ]);
}

export function createAuthLoginRateLimitRouteOptions(): AuthRateLimitRouteOptions {
  const config: ApiRouteThrottleConfig = getApiConfig().throttle.login.route;

  return createAuthRateLimitRouteOptions('auth.login.route', config, readScopedAuthRateLimitKey);
}

export function createAuthActivationRateLimitRouteOptions(): AuthRateLimitRouteOptions {
  const config: ApiRouteThrottleConfig = getApiConfig().throttle.activation.route;

  return createAuthRateLimitRouteOptions('auth.activate.route', config, readScopedAuthRateLimitKey);
}

export function createAuthResetPasswordRateLimitRouteOptions(): AuthRateLimitRouteOptions {
  const config: ApiRouteThrottleConfig = getApiConfig().throttle.resetPassword.route;

  return createAuthRateLimitRouteOptions('auth.reset_password.route', config, readResetPasswordRateLimitKey);
}

export const authCliLoginRateLimitRouteOptions: AuthRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.authCliLogin,
  readCliLoginAttemptRateLimitKey,
);

function createAuthRateLimitRouteOptions(
  bucketId: string,
  config: ApiRouteThrottleConfig,
  keyGenerator: ApiRateLimitKeyGenerator,
): AuthRateLimitRouteOptions {
  return createApiRateLimitRouteOptions(buildAuthRateLimitPolicy(bucketId, config), keyGenerator);
}

function buildAuthRateLimitPolicy(bucketId: string, config: ApiRouteThrottleConfig): ApiRateLimitPolicy {
  return {
    bucketId,
    hook: 'preHandler',
    max: config.maxRequests,
    timeWindow: config.windowMs,
  };
}
