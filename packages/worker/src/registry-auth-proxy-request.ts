import { authorizeRegistryRequest } from './registry-credentials';
import type { RegistryCredentialPayload } from './registry-credentials.types';

export function resolveAuthorizedRegistryRequestTarget(
  credential: RegistryCredentialPayload,
  method: string | undefined,
  requestTarget: string,
): string | null {
  if (authorizeRegistryRequest(credential, method, requestTarget) !== null) {
    return requestTarget;
  }
  const fallbackTarget: string | null = buildDeniedBlobMountFallbackTarget(credential, method, requestTarget);
  return fallbackTarget !== null && authorizeRegistryRequest(credential, method, fallbackTarget) !== null
    ? fallbackTarget
    : null;
}

function buildDeniedBlobMountFallbackTarget(
  credential: RegistryCredentialPayload,
  method: string | undefined,
  requestTarget: string,
): string | null {
  if (credential.access !== 'push' || credential.repository === undefined || method?.toUpperCase() !== 'POST') {
    return null;
  }
  const queryStartIndex: number = requestTarget.indexOf('?');
  const rawPathname: string = queryStartIndex === -1 ? requestTarget : requestTarget.slice(0, queryStartIndex);
  if (rawPathname !== `/v2/${credential.repository}/blobs/uploads/`) {
    return null;
  }
  const requestUrl: URL = new URL(requestTarget, 'https://registry.invalid');
  if (requestUrl.searchParams.get('from') === null || requestUrl.searchParams.get('mount') === null) {
    return null;
  }
  requestUrl.searchParams.delete('from');
  requestUrl.searchParams.delete('mount');
  return `${requestUrl.pathname}${requestUrl.search}`;
}
