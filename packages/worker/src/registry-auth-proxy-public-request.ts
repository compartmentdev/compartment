const digestPathComponentPattern: string = String.raw`sha256:[a-f0-9]{64}`;
const repositoryComponentPattern: string = String.raw`[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*`;
const repositoryPathPattern: RegExp = new RegExp(
  String.raw`^${repositoryComponentPattern}(?:/${repositoryComponentPattern})*$`,
  'u',
);

export function isRegistryRepositoryPath(value: string): boolean {
  return repositoryPathPattern.test(value);
}

export function resolvePublicBuildKitSeedRequestTarget(
  repository: string,
  method: string | undefined,
  requestTarget: string,
): string | null {
  const normalizedMethod: string | undefined = method?.toUpperCase();
  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    return null;
  }
  if (requestTarget === '/v2/') {
    return requestTarget;
  }
  const escapedRepository: string = repository.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const seedPullPathPattern: RegExp = new RegExp(
    `^/v2/${escapedRepository}/(?:manifests|blobs)/${digestPathComponentPattern}$`,
    'u',
  );
  return seedPullPathPattern.test(requestTarget) ? requestTarget : null;
}
