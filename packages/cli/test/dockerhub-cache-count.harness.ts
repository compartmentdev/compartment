export function parseDockerHubCacheBlobCount(output: string): number {
  const trimmedOutput: string = output.trim();
  if (!/^[0-9]+$/.test(trimmedOutput)) {
    throw new Error(`Expected a Docker Hub cache blob count, received ${trimmedOutput}.`);
  }
  const count: number = Number(trimmedOutput);
  if (!Number.isSafeInteger(count)) {
    throw new Error(`Expected a Docker Hub cache blob count, received ${trimmedOutput}.`);
  }
  return count;
}
