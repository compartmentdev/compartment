const encodedDotPattern: RegExp = /%2e/giu;
const encodedPathSeparatorPattern: RegExp = /%2f|%5c/iu;
const pathComponentEndPattern: RegExp = /[?#]/u;

export function sanitizeSafeRelativePath(path: string): string {
  return isSafeRelativePath(path) ? path : '/';
}

export function isSafeRelativePath(path: string | undefined): path is string {
  if (path?.startsWith('/') !== true || path.startsWith('//')) {
    return false;
  }

  const pathname: string = readRelativePathname(path);
  return (
    !pathname.includes('\\') && !encodedPathSeparatorPattern.test(pathname) && !hasParentDirectoryPathSegment(pathname)
  );
}

function readRelativePathname(path: string): string {
  const pathComponentEndIndex: number = path.search(pathComponentEndPattern);
  return pathComponentEndIndex === -1 ? path : path.slice(0, pathComponentEndIndex);
}

function hasParentDirectoryPathSegment(pathname: string): boolean {
  return pathname
    .split('/')
    .some((segment: string, index: number): boolean => index !== 0 && isUnsafeDotSegment(segment));
}

function isUnsafeDotSegment(segment: string): boolean {
  const decodedDotSegment: string = segment.replace(encodedDotPattern, '.');
  return decodedDotSegment === '.' || decodedDotSegment === '..';
}
