export function parseLogsSince(since: string | undefined): Date | undefined {
  if (since === undefined) {
    return undefined;
  }

  return new Date(since);
}
