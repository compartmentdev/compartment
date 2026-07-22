import { compartmentCurrentOrganizationHeaderName } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { ClientOptions } from '../client.types';

interface RequestHeaderOptions {
  currentOrganization?: string | undefined;
  idempotencyKey?: string | undefined;
  internalToken?: string | undefined;
  sessionToken?: string | undefined;
}

export function createRequestHeaders<TBody>(
  body: TBody | undefined,
  options: RequestHeaderOptions,
  defaults: ClientOptions,
): Headers {
  return createRawRequestHeaders(
    body !== undefined && !(body instanceof FormData) ? 'application/json' : null,
    options,
    defaults,
  );
}

export function createRawRequestHeaders(
  contentType: string | null,
  options: RequestHeaderOptions,
  defaults: ClientOptions,
): Headers {
  const headers: Headers = new Headers({ Accept: 'application/json' });
  if (contentType !== null) {
    headers.set('Content-Type', contentType);
  }
  const token: string | undefined =
    options.sessionToken ?? defaults.sessionToken ?? options.internalToken ?? defaults.internalToken;
  if (hasText(token)) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const organization: string | undefined = options.currentOrganization ?? defaults.currentOrganization;
  if (hasText(organization)) {
    headers.set(compartmentCurrentOrganizationHeaderName, organization);
  }
  if (hasText(options.idempotencyKey)) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }
  return headers;
}
