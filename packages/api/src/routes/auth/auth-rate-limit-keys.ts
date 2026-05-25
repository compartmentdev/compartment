import { loginDiscoveryRequestSchema, type LoginDiscoveryRequest } from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import type { SafeParseReturnType } from 'zod';
import type { AuthThrottleFields } from '../../services/auth-throttle-keys.service.types';
import {
  buildAccountScopedAuthThrottleKey,
  buildScopedAuthThrottleKey,
  buildSubjectScopedAuthThrottleKey,
  readAuthThrottleFields,
} from '../../services/auth-throttle-keys.service';

type AuthRateLimitBodyValue = boolean | number | object | string | null | undefined;

interface AuthRateLimitBody {
  attemptId?: AuthRateLimitBodyValue;
  email?: AuthRateLimitBodyValue;
  host?: AuthRateLimitBodyValue;
  organizationSlug?: AuthRateLimitBodyValue;
}

type AuthRateLimitRequestBody = AuthRateLimitBody | AuthRateLimitBodyValue[] | null | undefined;

export function readScopedAuthRateLimitKey(request: FastifyRequest): string {
  return buildScopedAuthThrottleKey(
    readAuthThrottleFieldsFromBody(request.body as AuthRateLimitRequestBody),
    request.ip,
  );
}

export function readLoginDiscoverySubjectRateLimitKey(request: FastifyRequest): string {
  const parsedBody: LoginDiscoveryRequest | null = readLoginDiscoveryRequestBody(
    request.body as AuthRateLimitRequestBody,
  );
  if (parsedBody === null) {
    return request.ip;
  }

  const accountKey: string | undefined = buildAccountScopedAuthThrottleKey(
    readAuthThrottleFields(parsedBody.email, parsedBody.host, parsedBody.organizationSlug),
  );

  return accountKey ?? request.ip;
}

export function readResetPasswordRateLimitKey(request: FastifyRequest): string {
  const fields: AuthThrottleFields = readAuthThrottleFieldsFromBody(request.body as AuthRateLimitRequestBody);

  return buildSubjectScopedAuthThrottleKey(fields.email, request.ip);
}

export function readCliLoginAttemptRateLimitKey(request: FastifyRequest): string {
  const attemptId: string | undefined = readTextField(
    readAuthRateLimitBody(request.body as AuthRateLimitRequestBody)?.attemptId,
  );
  if (attemptId === undefined) {
    return request.ip;
  }

  return `${request.ip}|attempt:${attemptId}`;
}

function readAuthThrottleFieldsFromBody(body: AuthRateLimitRequestBody): AuthThrottleFields {
  const parsedBody: AuthRateLimitBody | undefined = readAuthRateLimitBody(body);
  if (parsedBody === undefined) {
    return {};
  }

  return readAuthThrottleFields(parsedBody.email, parsedBody.host, parsedBody.organizationSlug);
}

function readLoginDiscoveryRequestBody(body: AuthRateLimitRequestBody): LoginDiscoveryRequest | null {
  const parsedBody: SafeParseReturnType<AuthRateLimitRequestBody, LoginDiscoveryRequest> =
    loginDiscoveryRequestSchema.safeParse(body);

  return parsedBody.success ? parsedBody.data : null;
}

function readAuthRateLimitBody(value: AuthRateLimitRequestBody): AuthRateLimitBody | undefined {
  if (!isAuthRateLimitBody(value)) {
    return undefined;
  }

  return value;
}

function isAuthRateLimitBody(value: AuthRateLimitRequestBody): value is AuthRateLimitBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTextField(value: AuthRateLimitBodyValue): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue: string = value.trim();
  return trimmedValue === '' ? undefined : trimmedValue;
}
