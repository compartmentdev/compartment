import { hasDuplicateSearchParamName, hasText, readSingleSearchParam } from '@compartment/utils';
import { createInvalidSsoLoginError } from '../../errors/api-business-error';

const ssoOidcCallbackCodeSearchParamName: string = 'code';
const ssoOidcCallbackStateSearchParamName: string = 'state';
const ssoOidcCallbackErrorSearchParamName: string = 'error';
const ssoOidcCallbackErrorDescriptionSearchParamName: string = 'error_description';
const ssoOidcCallbackErrorUriSearchParamName: string = 'error_uri';

export type SsoOidcCallbackKind = 'failure' | 'success';

export function readRequiredSsoOidcSuccessCallbackState(currentUrl: URL): string {
  assertValidSsoOidcSuccessCallbackUrl(currentUrl);
  const state: string | null = readSingleSearchParam(currentUrl.searchParams, ssoOidcCallbackStateSearchParamName);
  if (!hasText(state)) {
    throw createInvalidSsoLoginError();
  }

  return state;
}

export function readSsoOidcCallbackStateForFailureHandling(currentUrl: URL): string | null {
  if (readSsoOidcCallbackKind(currentUrl) === null) {
    return null;
  }

  const state: string | null = readSingleSearchParam(currentUrl.searchParams, ssoOidcCallbackStateSearchParamName);
  return hasText(state) ? state : null;
}

export function assertValidSsoOidcSuccessCallbackUrl(currentUrl: URL): void {
  if (readSsoOidcCallbackKind(currentUrl) !== 'success') {
    throw createInvalidSsoLoginError();
  }
}

export function readSsoOidcCallbackKind(currentUrl: URL): SsoOidcCallbackKind | null {
  const searchParams: URLSearchParams = currentUrl.searchParams;
  if (hasDuplicateSearchParamName(searchParams)) {
    return null;
  }

  const hasCode: boolean = searchParams.has(ssoOidcCallbackCodeSearchParamName);
  const hasError: boolean = searchParams.has(ssoOidcCallbackErrorSearchParamName);
  if (hasCode) {
    return hasValidSuccessCallbackSearchParams(searchParams) ? 'success' : null;
  }

  return hasError && hasValidFailureCallbackSearchParams(searchParams) ? 'failure' : null;
}

function hasValidSuccessCallbackSearchParams(searchParams: URLSearchParams): boolean {
  return (
    hasText(readSingleSearchParam(searchParams, ssoOidcCallbackCodeSearchParamName)) &&
    hasText(readSingleSearchParam(searchParams, ssoOidcCallbackStateSearchParamName)) &&
    !hasFailureSearchParam(searchParams)
  );
}

function hasValidFailureCallbackSearchParams(searchParams: URLSearchParams): boolean {
  return (
    hasText(readSingleSearchParam(searchParams, ssoOidcCallbackErrorSearchParamName)) &&
    !searchParams.has(ssoOidcCallbackCodeSearchParamName)
  );
}

function hasFailureSearchParam(searchParams: URLSearchParams): boolean {
  return (
    searchParams.has(ssoOidcCallbackErrorSearchParamName) ||
    searchParams.has(ssoOidcCallbackErrorDescriptionSearchParamName) ||
    searchParams.has(ssoOidcCallbackErrorUriSearchParamName)
  );
}
