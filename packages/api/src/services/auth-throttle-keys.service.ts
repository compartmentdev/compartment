import type { LoginRequest } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type {
  AuthThrottleFieldInput,
  AuthThrottleFields,
  LoginThrottleIdentity,
  SubjectThrottleIdentity,
} from './auth-throttle-keys.service.types';

const defaultAuthThrottleOrganizationKey: string = 'default';

export function buildLoginThrottleIdentity(requestBody: LoginRequest, sourceIp: string): LoginThrottleIdentity {
  const accountKey: string = buildAccountThrottleKey({
    email: requestBody.email,
    host: requestBody.host,
    organizationSlug: requestBody.organizationSlug,
  });

  return {
    accountKey,
    sourceAccountKey: `${sourceIp}|${accountKey}`,
    sourceKey: sourceIp,
  };
}

export function buildSubjectScopedAuthThrottleKey(email: string | undefined, sourceIp: string): string {
  if (email === undefined) {
    return sourceIp;
  }

  return `${sourceIp}|${normalizeEmail(email)}`;
}

export function buildSubjectThrottleIdentity(email: string, sourceIp: string): SubjectThrottleIdentity {
  const subjectKey: string = normalizeEmail(email);

  return {
    sourceKey: sourceIp,
    sourceSubjectKey: `${sourceIp}|${subjectKey}`,
    subjectKey,
  };
}

export function buildScopedAuthThrottleKey(fields: AuthThrottleFields, sourceIp: string): string {
  const accountKey: string | undefined = buildAccountScopedAuthThrottleKey(fields);

  return accountKey === undefined ? sourceIp : `${sourceIp}|${accountKey}`;
}

export function buildAccountScopedAuthThrottleKey(fields: AuthThrottleFields): string | undefined {
  if (fields.email === undefined) {
    return undefined;
  }

  return buildAccountThrottleKey(fields);
}

export function readAuthThrottleFields(
  email: AuthThrottleFieldInput,
  host: AuthThrottleFieldInput,
  organizationSlug: AuthThrottleFieldInput,
): AuthThrottleFields {
  return {
    email: readTextField(email),
    host: readTextField(host),
    organizationSlug: readTextField(organizationSlug),
  };
}

function buildAccountThrottleKey(fields: AuthThrottleFields): string {
  return `${normalizeEmail(fields.email)}|${readOrganizationThrottleKey(fields)}`;
}

function readOrganizationThrottleKey(fields: AuthThrottleFields): string {
  if (fields.host !== undefined) {
    return `host:${normalizeOrganizationSelector(fields.host)}`;
  }
  if (fields.organizationSlug !== undefined) {
    return `org:${normalizeOrganizationSelector(fields.organizationSlug)}`;
  }

  return defaultAuthThrottleOrganizationKey;
}

function normalizeEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() ?? '';
}

function normalizeOrganizationSelector(value: string): string {
  return value.trim().toLowerCase();
}

function readTextField(value: AuthThrottleFieldInput): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return hasText(value) ? value.trim() : undefined;
}
