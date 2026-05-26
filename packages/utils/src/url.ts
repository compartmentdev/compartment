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

export function hasDuplicateSearchParamName(searchParams: URLSearchParams): boolean {
  const names: Set<string> = new Set<string>();
  let hasDuplicateName: boolean = false;

  searchParams.forEach((_value: string, name: string): void => {
    if (names.has(name)) {
      hasDuplicateName = true;
    } else {
      names.add(name);
    }
  });

  return hasDuplicateName;
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
