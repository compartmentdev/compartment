export const selfHostedRuntimeImageArtifacts = Object.freeze(['api', 'caddy', 'edge', 'worker']);
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
