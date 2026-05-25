export function normalizeRepositoryRelativePath(value: string): string {
  if (value.startsWith('/')) {
    return value;
  }

  const normalizedSegments: string[] = readNormalizedRepositoryRelativeSegments(value);
  return normalizedSegments.length === 0 ? '.' : normalizedSegments.join('/');
}

export function isLiteralRepositoryRelativePath(value: string): boolean {
  if (value === '' || value.startsWith('/')) {
    return false;
  }

  const segments: string[] = value.split('/');
  if (segments.some((segment: string): boolean => segment.includes(':'))) {
    return false;
  }

  return !segments.some((segment: string): boolean => segment === '' || segment === '.' || segment === '..');
}

function readNormalizedRepositoryRelativeSegments(value: string): string[] {
  const normalizedSegments: string[] = [];
  for (const segment of value.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      applyParentSegment(normalizedSegments);
      continue;
    }
    normalizedSegments.push(segment);
  }

  return normalizedSegments;
}

function applyParentSegment(normalizedSegments: string[]): void {
  const previousSegment: string | undefined = normalizedSegments[normalizedSegments.length - 1];
  if (previousSegment !== undefined && previousSegment !== '..') {
    normalizedSegments.pop();
    return;
  }

  normalizedSegments.push('..');
}
