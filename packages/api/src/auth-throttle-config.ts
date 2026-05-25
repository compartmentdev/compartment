import { z } from 'zod';
import { readRequiredDurationMs } from './read-required-duration-ms';
import type {
  ApiAuthActivationThrottleConfig,
  ApiAuthLoginThrottleConfig,
  ApiAuthResetPasswordThrottleConfig,
  ApiAuthThrottleConfig,
  ApiCooldownThrottleConfig,
  ApiRouteThrottleConfig,
} from './auth-throttle-config.types';

export type { ApiAuthThrottleConfig } from './auth-throttle-config.types';

interface ApiAuthThrottleConfigEnv {
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_MAX_REQUESTS: number;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_MAX_REQUESTS: number;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS: number;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW: string;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_BLOCK: string;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_MAX_FAILURES: number;
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_WINDOW: string;
}

const apiAuthThrottleConfigSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_MAX_REQUESTS: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_MAX_REQUESTS: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_BLOCK: z.string().min(1),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_MAX_FAILURES: z.coerce.number().int().positive(),
  COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_WINDOW: z.string().min(1),
});

export function readApiAuthThrottleConfig(env: NodeJS.ProcessEnv = process.env): ApiAuthThrottleConfig {
  const parsed: ApiAuthThrottleConfigEnv = apiAuthThrottleConfigSchema.parse(env) as ApiAuthThrottleConfigEnv;

  return {
    activation: readActivationThrottleConfig(parsed),
    login: readLoginThrottleConfig(parsed),
    resetPassword: readResetPasswordThrottleConfig(parsed),
  };
}

function readLoginThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiAuthLoginThrottleConfig {
  return {
    account: readLoginAccountThrottleConfig(parsed),
    route: readLoginRouteThrottleConfig(parsed),
    source: readLoginSourceThrottleConfig(parsed),
    sourceAccount: readLoginSourceAccountThrottleConfig(parsed),
  };
}

function readActivationThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiAuthActivationThrottleConfig {
  return {
    route: readActivationRouteThrottleConfig(parsed),
    source: readActivationSourceThrottleConfig(parsed),
    sourceSubject: readActivationSourceSubjectThrottleConfig(parsed),
    subject: readActivationSubjectThrottleConfig(parsed),
  };
}

function readResetPasswordThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiAuthResetPasswordThrottleConfig {
  return {
    route: readResetPasswordRouteThrottleConfig(parsed),
    source: readResetPasswordSourceThrottleConfig(parsed),
    sourceSubject: readResetPasswordSourceSubjectThrottleConfig(parsed),
    subject: readResetPasswordSubjectThrottleConfig(parsed),
  };
}

function readLoginAccountThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_LOGIN_ACCOUNT_BLOCK',
  );
}

function readLoginRouteThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiRouteThrottleConfig {
  return readRouteThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_MAX_REQUESTS,
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_WINDOW,
    'COMPARTMENT_THROTTLE_AUTH_LOGIN_ROUTE_WINDOW',
  );
}

function readLoginSourceThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_BLOCK',
  );
}

function readLoginSourceAccountThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_LOGIN_SOURCE_ACCOUNT_BLOCK',
  );
}

function readActivationRouteThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiRouteThrottleConfig {
  return readRouteThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_MAX_REQUESTS,
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_WINDOW,
    'COMPARTMENT_THROTTLE_AUTH_ACTIVATE_ROUTE_WINDOW',
  );
}

function readActivationSourceThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_BLOCK',
  );
}

function readActivationSourceSubjectThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SOURCE_SUBJECT_BLOCK',
  );
}

function readActivationSubjectThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_ACTIVATE_SUBJECT_BLOCK',
  );
}

function readResetPasswordRouteThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiRouteThrottleConfig {
  return readRouteThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS,
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_WINDOW,
    'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_WINDOW',
  );
}

function readResetPasswordSourceThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_BLOCK',
  );
}

function readResetPasswordSourceSubjectThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_BLOCK',
  );
}

function readResetPasswordSubjectThrottleConfig(parsed: ApiAuthThrottleConfigEnv): ApiCooldownThrottleConfig {
  return readCooldownThrottleConfig(
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_MAX_FAILURES,
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_WINDOW,
    parsed.COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_BLOCK,
    'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_WINDOW',
    'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_BLOCK',
  );
}

function readRouteThrottleConfig(
  maxRequests: number,
  window: string,
  windowVariableName: string,
): ApiRouteThrottleConfig {
  return {
    maxRequests,
    windowMs: readRequiredDurationMs(window, windowVariableName),
  };
}

function readCooldownThrottleConfig(
  maxFailures: number,
  window: string,
  block: string,
  windowVariableName: string,
  blockVariableName: string,
): ApiCooldownThrottleConfig {
  return {
    blockMs: readRequiredDurationMs(block, blockVariableName),
    maxFailures,
    windowMs: readRequiredDurationMs(window, windowVariableName),
  };
}
