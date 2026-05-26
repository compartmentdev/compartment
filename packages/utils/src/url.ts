import { hasText } from './text';

export function appendOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    searchParams.set(name, value);
  }
}

export function hasDuplicateSearchParam(searchParams: URLSearchParams, name: string): boolean {
  return searchParams.getAll(name).length > 1;
}

export function readSingleSearchParam(searchParams: URLSearchParams, name: string): string | null {
  const values: string[] = searchParams.getAll(name);

  return values.length === 1 ? (values[0] ?? null) : null;
}

export function readUrlOrigin(value: string | undefined): string | null {
  if (!hasText(value)) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
