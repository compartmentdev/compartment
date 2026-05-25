import { z } from 'zod';
import type { ContractSchema } from './schema.types';

const encodedDotPattern: RegExp = /%2e/giu;
const encodedPathSeparatorPattern: RegExp = /%2f|%5c/iu;
const pathComponentEndPattern: RegExp = /[?#]/u;
const pathSeparator: string = '/';

export const safeRelativePathSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .refine(isSafeRelativePath, 'Expected a safe app-relative path.');

function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) {
    return false;
  }

  const pathname: string = readRelativePathname(path);
  return !pathname.includes('\\') && !encodedPathSeparatorPattern.test(pathname) && !hasUnsafePathSegment(pathname);
}

function readRelativePathname(path: string): string {
  const pathComponentEndIndex: number = path.search(pathComponentEndPattern);
  return pathComponentEndIndex === -1 ? path : path.slice(0, pathComponentEndIndex);
}

function hasUnsafePathSegment(pathname: string): boolean {
  let segmentStartIndex: number = 1;
  while (segmentStartIndex <= pathname.length) {
    const nextSeparatorIndex: number = pathname.indexOf(pathSeparator, segmentStartIndex);
    const segmentEndIndex: number = nextSeparatorIndex === -1 ? pathname.length : nextSeparatorIndex;
    const segment: string = pathname.slice(segmentStartIndex, segmentEndIndex).replace(encodedDotPattern, '.');
    if (segment === '.' || segment === '..') {
      return true;
    }
    if (nextSeparatorIndex === -1) {
      return false;
    }
    segmentStartIndex = nextSeparatorIndex + 1;
  }

  return false;
}
