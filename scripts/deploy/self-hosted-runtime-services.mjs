export const selfHostedRuntimeImageArtifacts = Object.freeze([
  'api',
  'caddy',
  'dns01-solver',
  'edge',
  'worker',
  // Publish the seed last so an interrupted immutable-tag reconciliation cannot expose it without its worker pair.
  'buildkit-seed',
]);
export const defaultSelfHostedImageRepositoryPrefix = 'ghcr.io/compartmentdev';
const dockerHubSelfHostedImageRepositoryPrefix = 'docker.io/compartmentdev';
export const selfHostedImageRepositoryPrefixes = Object.freeze([
  defaultSelfHostedImageRepositoryPrefix,
  dockerHubSelfHostedImageRepositoryPrefix,
]);

export function buildSelfHostedImageRef(serviceName, tag, repositoryPrefix = defaultSelfHostedImageRepositoryPrefix) {
  return buildSelfHostedImageRefForRepository(serviceName, tag, repositoryPrefix);
}

export function buildSelfHostedImageRefForRepository(serviceName, tag, repositoryPrefix) {
  return `${repositoryPrefix}/compartment-${serviceName}:${tag}`;
}
