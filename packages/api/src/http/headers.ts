import type { IncomingHttpHeaders } from 'node:http';
import { compartmentCurrentOrganizationHeaderName } from '@compartment/contracts';
import { hasText, readBearerToken, readHeaderValue } from '@compartment/utils';
import { ApiBoundaryError } from '../errors/api-boundary-error';

export function requireExpectedBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
  code: string,
  message: string,
): void {
  const token: string = requireBearerToken(authorizationHeader, code, message);
  if (token !== expectedToken) {
    throw new ApiBoundaryError(401, code, message);
  }
}

export function requireCurrentOrganizationHeaderValue(headers: IncomingHttpHeaders): string {
  const organizationSlug: string | undefined = getCurrentOrganizationHeaderValue(headers);

  if (!hasText(organizationSlug)) {
    throw new ApiBoundaryError(400, 'missing_current_organization', 'A current organization header is required.');
  }

  return organizationSlug;
}

export function getCurrentOrganizationHeaderValue(headers: IncomingHttpHeaders): string | undefined {
  return readHeaderValue(headers[compartmentCurrentOrganizationHeaderName]);
}

export function requireBearerToken(authorizationHeader: string | undefined, code: string, message: string): string {
  const token: string | undefined = readBearerToken(authorizationHeader);
  if (token === undefined) {
    throw new ApiBoundaryError(401, code, message);
  }

  return token;
}
