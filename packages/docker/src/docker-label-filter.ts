export function buildDockerLabelFilters(filters: Record<string, string | undefined>): string[] {
  return Object.entries(filters)
    .filter(([, value]: [string, string | undefined]): boolean => value !== undefined)
    .map(([name, value]: [string, string | undefined]): string => (value === undefined ? name : `${name}=${value}`));
}
