export function readOptionalOnboardingSearchParam(searchParams: URLSearchParams, name: string): string | undefined {
  const value: string | null = searchParams.get(name);
  return value === null || value === '' ? undefined : value;
}
