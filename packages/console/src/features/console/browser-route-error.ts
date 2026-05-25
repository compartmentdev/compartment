import { isRouteErrorResponse } from 'react-router';
import { browserLoginPathname, browserSelectedOrganizationSearchParamName } from '../../browser-public-paths';
import { BrowserApiError } from '../../lib/browser-api';
import { buildBrowserConsoleProjectsHref } from './console-hrefs';

type BrowserRouteErrorInput = object | string | number | boolean | bigint | symbol | null | undefined;

export interface BrowserRouteErrorViewModel {
  details?: string | undefined;
  message: string;
  primaryActionHref: string;
  primaryActionLabel: string;
  statusCode?: number | undefined;
  title: string;
}

interface BrowserRouteErrorClassification {
  message: string;
  primaryActionHref: string;
  primaryActionLabel: string;
  statusCode?: number | undefined;
  title: string;
}

interface BrowserRouteErrorRecoveryTarget {
  href: string;
  label: string;
}

export function createBrowserRouteErrorViewModel(
  error: BrowserRouteErrorInput,
  isDevelopment: boolean,
  currentPathname?: string,
  currentSearch?: string,
): BrowserRouteErrorViewModel {
  const classification: BrowserRouteErrorClassification = classifyBrowserRouteError(
    error,
    currentPathname,
    currentSearch,
  );

  return {
    ...classification,
    details: isDevelopment ? readBrowserRouteErrorDetails(error) : undefined,
  };
}

function classifyBrowserRouteError(
  error: BrowserRouteErrorInput,
  currentPathname: string | undefined,
  currentSearch: string | undefined,
): BrowserRouteErrorClassification {
  const statusCode: number | null = readBrowserRouteErrorStatusCode(error);
  if (statusCode === null) {
    return createUnexpectedBrowserRouteErrorClassification(currentPathname, currentSearch);
  }

  switch (statusCode) {
    case 401:
      return createUnauthorizedBrowserRouteErrorClassification();
    case 403:
      return createForbiddenBrowserRouteErrorClassification(currentPathname, currentSearch);
    case 404:
      return createNotFoundBrowserRouteErrorClassification(currentPathname, currentSearch);
    default:
      return createUnexpectedBrowserRouteErrorClassification(currentPathname, currentSearch, statusCode);
  }
}

function createUnauthorizedBrowserRouteErrorClassification(): BrowserRouteErrorClassification {
  return {
    message: 'Your browser console session is no longer available. Sign in to continue.',
    primaryActionHref: browserLoginPathname,
    primaryActionLabel: 'Go to login',
    statusCode: 401,
    title: 'Sign in again',
  };
}

function createForbiddenBrowserRouteErrorClassification(
  currentPathname: string | undefined,
  currentSearch: string | undefined,
): BrowserRouteErrorClassification {
  const recoveryTarget: BrowserRouteErrorRecoveryTarget = readBrowserRouteErrorRecoveryTarget(
    currentPathname,
    currentSearch,
  );

  return {
    message: 'You do not have permission to open this browser console page.',
    primaryActionHref: recoveryTarget.href,
    primaryActionLabel: recoveryTarget.label,
    statusCode: 403,
    title: 'Access denied',
  };
}

function createNotFoundBrowserRouteErrorClassification(
  currentPathname: string | undefined,
  currentSearch: string | undefined,
): BrowserRouteErrorClassification {
  const recoveryTarget: BrowserRouteErrorRecoveryTarget = readBrowserRouteErrorRecoveryTarget(
    currentPathname,
    currentSearch,
  );

  return {
    message: 'This browser console page is not available.',
    primaryActionHref: recoveryTarget.href,
    primaryActionLabel: recoveryTarget.label,
    statusCode: 404,
    title: 'Page not found',
  };
}

function createUnexpectedBrowserRouteErrorClassification(
  currentPathname: string | undefined,
  currentSearch: string | undefined,
  statusCode?: number,
): BrowserRouteErrorClassification {
  const recoveryTarget: BrowserRouteErrorRecoveryTarget = readBrowserRouteErrorRecoveryTarget(
    currentPathname,
    currentSearch,
  );

  return {
    message: 'Reload the browser console. If the problem keeps happening, use the recovery action below.',
    primaryActionHref: recoveryTarget.href,
    primaryActionLabel: recoveryTarget.label,
    statusCode,
    title: 'We could not load this page',
  };
}

function readBrowserRouteErrorRecoveryTarget(
  currentPathname: string | undefined,
  currentSearch: string | undefined,
): BrowserRouteErrorRecoveryTarget {
  const selectedOrganizationSlug: string | null = readBrowserRouteErrorSelectedOrganizationSlug(
    currentPathname,
    currentSearch,
  );
  if (canRecoverBrowserRouteErrorToProjects(currentPathname, selectedOrganizationSlug)) {
    return {
      href: buildBrowserConsoleProjectsHref(selectedOrganizationSlug),
      label: 'Go to projects',
    };
  }

  return {
    href: browserLoginPathname,
    label: 'Go to login',
  };
}

function canRecoverBrowserRouteErrorToProjects(
  currentPathname: string | undefined,
  selectedOrganizationSlug: string | null,
): selectedOrganizationSlug is string {
  return (
    selectedOrganizationSlug !== null && currentPathname !== buildBrowserConsoleProjectsHref(selectedOrganizationSlug)
  );
}

function readBrowserRouteErrorSelectedOrganizationSlug(
  currentPathname: string | undefined,
  currentSearch: string | undefined,
): string | null {
  const pathOrganizationSlug: string | null = readBrowserRouteErrorPathOrganizationSlug(currentPathname);
  if (pathOrganizationSlug !== null) {
    return pathOrganizationSlug;
  }

  return new URLSearchParams(currentSearch ?? '').get(browserSelectedOrganizationSearchParamName);
}

function readBrowserRouteErrorPathOrganizationSlug(currentPathname: string | undefined): string | null {
  if (currentPathname === undefined) {
    return null;
  }

  const [, prefix, organizationSlug] = currentPathname.split('/');
  return prefix === 'orgs' && organizationSlug !== undefined
    ? decodeBrowserRouteErrorPathSegment(organizationSlug)
    : null;
}

function decodeBrowserRouteErrorPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function readBrowserRouteErrorStatusCode(error: BrowserRouteErrorInput): number | null {
  if (error instanceof BrowserApiError) {
    return error.status;
  }
  if (isRouteErrorResponse(error)) {
    return error.status;
  }

  return null;
}

function readBrowserRouteErrorDetails(error: BrowserRouteErrorInput): string | undefined {
  if (error instanceof BrowserApiError) {
    return formatBrowserApiErrorDetails(error);
  }
  if (isRouteErrorResponse(error)) {
    return formatRouteErrorResponseDetails(error);
  }
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return `Thrown value\n${serializeDebugValue(error)}`;
}

function formatBrowserApiErrorDetails(error: BrowserApiError): string {
  const lines: string[] = [`${error.name}: ${error.message}`, `Status: ${error.status}`];
  if (error.stack !== undefined) {
    lines.push('', error.stack);
  }

  return lines.join('\n');
}

function formatRouteErrorResponseDetails(error: BrowserRouteErrorInput): string {
  if (!isRouteErrorResponse(error)) {
    return '';
  }

  const lines: string[] = [`Route error response: ${error.status} ${error.statusText}`.trim()];
  const responseData: BrowserRouteErrorInput | undefined = readRouteErrorResponseData(error);
  if (responseData !== undefined) {
    lines.push('', serializeDebugValue(responseData));
  }

  return lines.join('\n');
}

function readRouteErrorResponseData(error: BrowserRouteErrorInput): BrowserRouteErrorInput | undefined {
  if (!isRouteErrorResponse(error)) {
    return undefined;
  }

  return error.data as BrowserRouteErrorInput;
}

function serializeDebugValue(value: BrowserRouteErrorInput): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    if (typeof value === 'object') {
      return '[Unserializable route error value]';
    }

    return String(value);
  }
}
