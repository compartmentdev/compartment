import { isSafeRelativePath } from '@compartment/utils';

export interface ParsedForwardedRequestPath {
  pathname: string;
  search: string;
}

export function parseSafeForwardedRequestPath(requestUri: string | undefined): ParsedForwardedRequestPath | null {
  if (!isSafeRelativePath(requestUri)) {
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
