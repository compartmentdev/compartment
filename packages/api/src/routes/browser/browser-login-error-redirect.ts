import { browserLoginSuccessRedirectSearchParamName, browserLoginPathname } from '../../browser-public-paths';
import { browserSsoFailedLoginErrorCode } from '../auth/auth-browser-errors';
import { appendBrowserFlowSearchParams } from './browser-flow.helpers';
import type { BrowserFlowTargetOrNull } from './browser-flow.types';

export function buildSsoErrorLoginUrl(flowTarget: BrowserFlowTargetOrNull, successRedirectTo?: string): string {
  const searchParams: URLSearchParams = new URLSearchParams({
    error: browserSsoFailedLoginErrorCode,
  });
  appendBrowserFlowSearchParams(searchParams, flowTarget);
  if (successRedirectTo !== undefined) {
    searchParams.set(browserLoginSuccessRedirectSearchParamName, successRedirectTo);
  }

  return `${browserLoginPathname}?${searchParams.toString()}`;
}
