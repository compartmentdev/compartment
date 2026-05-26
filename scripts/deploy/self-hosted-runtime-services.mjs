const selfHostedRuntimeServices = Object.freeze(['api', 'caddy', 'edge', 'worker']);
export const selfHostedRuntimeImageArtifacts = Object.freeze([...selfHostedRuntimeServices, 'runtime-probe']);
export const defaultSelfHostedImageRepositoryPrefix = 'ghcr.io/compartmentdev';
const dockerHubSelfHostedImageRepositoryPrefix = 'docker.io/compartmentdev';
export const selfHostedImageRepositoryPrefixes = Object.freeze([
  defaultSelfHostedImageRepositoryPrefix,
  dockerHubSelfHostedImageRepositoryPrefix,
]);

const runtimeImageVariableNames = Object.freeze({
  'runtime-probe': 'COMPARTMENT_RUNTIME_PROBE_IMAGE',
});

export function buildSelfHostedImageRef(serviceName, tag, repositoryPrefix = defaultSelfHostedImageRepositoryPrefix) {
  return buildSelfHostedImageRefForRepository(serviceName, tag, repositoryPrefix);
}

export function buildSelfHostedImageRefForRepository(serviceName, tag, repositoryPrefix) {
  return `${repositoryPrefix}/compartment-${serviceName}:${tag}`;
}

export function buildSelfHostedRuntimeImageVariableName(serviceName) {
  if (runtimeImageVariableNames[serviceName] !== undefined) {
    return runtimeImageVariableNames[serviceName];
  }

  return `COMPARTMENT_${serviceName.toUpperCase()}_IMAGE`;
}

export function listSelfHostedRuntimeImageSpecs() {
  return selfHostedRuntimeImageArtifacts.map((serviceName) => ({
    imageVariableName: buildSelfHostedRuntimeImageVariableName(serviceName),
    serviceName,
  }));
}
