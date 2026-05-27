import { isSafeRelativePath } from '@compartment/utils';

const coalescedForwardedPathPattern: RegExp = /,\s*\//u;

export interface ParsedForwardedRequestPath {
  pathname: string;
  search: string;
}

export function parseSafeForwardedRequestPath(requestUri: string | null): ParsedForwardedRequestPath | null {
  if (requestUri === null || coalescedForwardedPathPattern.test(requestUri) || !isSafeRelativePath(requestUri)) {
    return null;
  }

  const queryStartIndex: number = requestUri.indexOf('?');
  const pathname: string = queryStartIndex === -1 ? requestUri : requestUri.slice(0, queryStartIndex);
  const search: string = queryStartIndex === -1 ? '' : requestUri.slice(queryStartIndex);
  return {
    pathname,
    search,
  };
}

export function formatForwardedRequestPath(requestPath: ParsedForwardedRequestPath): string {
  return `${requestPath.pathname}${requestPath.search}`;
}
