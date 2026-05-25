import { compartmentCsrfHeaderName } from '@compartment/contracts';
import { readHeaderValue, readUrlOrigin } from '@compartment/utils';
import type { FastifyRequest } from 'fastify';
import { ApiBoundaryError } from '../errors/api-boundary-error';
import { getApiConfig } from '../runtime/runtime-access';
import { isMatchingBrowserCsrfToken } from '../services/browser-csrf-cookie.service';
import { buildRuntimePublicSettings } from '../services/public-hosts.service';

export function assertValidBrowserMutationRequest(request: FastifyRequest): void {
  if (
    !isSameOriginBrowserRequest(request) ||
    !isMatchingBrowserCsrfToken(request.headers.cookie, readCsrfHeader(request))
  ) {
    throw new ApiBoundaryError(403, 'invalid_browser_request', 'A valid browser request is required.');
  }
}

function readCsrfHeader(request: FastifyRequest): string | undefined {
  return readHeaderValue(request.headers[compartmentCsrfHeaderName.toLowerCase()]);
}

function isSameOriginBrowserRequest(request: FastifyRequest): boolean {
  const expectedOrigin: string = readConfiguredBrowserOrigin();
  const origin: string | undefined = readHeaderValue(request.headers.origin);
  if (origin !== undefined) {
    return origin === expectedOrigin;
  }

  return readUrlOrigin(readHeaderValue(request.headers.referer)) === expectedOrigin;
}

function readConfiguredBrowserOrigin(): string {
  return new URL(buildRuntimePublicSettings(getApiConfig()).compartmentUrl).origin;
}
