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
