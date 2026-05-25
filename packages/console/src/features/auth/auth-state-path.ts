export function buildAuthStatePath(pathname: string, searchParams: URLSearchParams, names: readonly string[]): string {
  const apiSearchParams: URLSearchParams = new URLSearchParams();
  for (const name of names) {
    const value: string | null = searchParams.get(name);
    if (value !== null) {
      apiSearchParams.set(name, value);
    }
  }

  const search: string = apiSearchParams.toString();
  return search === '' ? pathname : `${pathname}?${search}`;
}
