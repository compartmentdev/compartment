import type { SelfHostedImageSource } from '@compartment/contracts';
import { readRequiredSelfHostedEnvironmentValue, readSelfHostedEnvironmentValues } from './self-hosted-env-file';
import type {
  SelfHostedImageRefs,
  SelfHostedRuntimeImageRegistry,
  SelfHostedRuntimeSelection,
} from './self-hosted-env.types';

export const defaultSelfHostedRuntimeImageRegistry: SelfHostedRuntimeImageRegistry = 'github';
export const legacySelfHostedRuntimeImageRegistry: SelfHostedRuntimeImageRegistry = 'docker-hub';

const githubSelfHostedImageRepositoryPrefix: string = 'ghcr.io/compartmentdev';
const dockerHubSelfHostedImageRepositoryPrefix: string = 'docker.io/compartmentdev';
const runtimeProbeImageVariableName: string = 'COMPARTMENT_RUNTIME_PROBE_IMAGE';

export function buildPublishedSelfHostedRuntimeSelection(
  releaseVersion: string,
  imageRegistry: SelfHostedRuntimeImageRegistry = defaultSelfHostedRuntimeImageRegistry,
): SelfHostedRuntimeSelection {
  return {
    imageRefs: buildSelfHostedImageRefs(releaseVersion, imageRegistry),
    nodeVersion: releaseVersion,
  };
}

export function resolveCurrentSelfHostedRuntimeImageRegistry(
  imageRegistry: SelfHostedRuntimeImageRegistry | undefined,
  imageSource: SelfHostedImageSource,
  environmentValues: Record<string, string>,
): SelfHostedRuntimeImageRegistry {
  if (imageRegistry !== undefined) {
    return imageRegistry;
  }

  return (
    readSelfHostedRuntimeImageRegistryFromImageRef(
      readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_API_IMAGE'),
    ) ?? resolveStoredSelfHostedRuntimeImageRegistry(imageRegistry, imageSource)
  );
}

export function resolveStoredSelfHostedRuntimeImageRegistry(
  imageRegistry: SelfHostedRuntimeImageRegistry | undefined,
  imageSource: SelfHostedImageSource,
): SelfHostedRuntimeImageRegistry {
  if (imageRegistry !== undefined) {
    return imageRegistry;
  }
  if (imageSource === 'local') {
    return legacySelfHostedRuntimeImageRegistry;
  }

  return defaultSelfHostedRuntimeImageRegistry;
}

export function readSelfHostedImageRefsFromEnvironmentText(environmentText: string): SelfHostedImageRefs {
  const values: Record<string, string> = readSelfHostedEnvironmentValues(environmentText);

  return {
    apiImage: readRequiredSelfHostedEnvironmentValue(values, 'COMPARTMENT_API_IMAGE'),
    caddyImage: readRequiredSelfHostedEnvironmentValue(values, 'COMPARTMENT_CADDY_IMAGE'),
    edgeImage: readRequiredSelfHostedEnvironmentValue(values, 'COMPARTMENT_EDGE_IMAGE'),
    runtimeProbeImage: readRequiredSelfHostedEnvironmentValue(values, runtimeProbeImageVariableName),
    workerImage: readRequiredSelfHostedEnvironmentValue(values, 'COMPARTMENT_WORKER_IMAGE'),
  };
}

function buildSelfHostedImageRefs(
  releaseVersion: string,
  imageRegistry: SelfHostedRuntimeImageRegistry,
): SelfHostedImageRefs {
  return {
    apiImage: buildSelfHostedImageRef('api', releaseVersion, imageRegistry),
    caddyImage: buildSelfHostedImageRef('caddy', releaseVersion, imageRegistry),
    edgeImage: buildSelfHostedImageRef('edge', releaseVersion, imageRegistry),
    runtimeProbeImage: buildSelfHostedImageRef('runtime-probe', releaseVersion, imageRegistry),
    workerImage: buildSelfHostedImageRef('worker', releaseVersion, imageRegistry),
  };
}

function buildSelfHostedImageRef(
  serviceName: string,
  tag: string,
  imageRegistry: SelfHostedRuntimeImageRegistry,
): string {
  return `${buildSelfHostedImageRepositoryPrefix(imageRegistry)}/compartment-${serviceName}:${tag}`;
}

function buildSelfHostedImageRepositoryPrefix(imageRegistry: SelfHostedRuntimeImageRegistry): string {
  switch (imageRegistry) {
    case 'github':
      return githubSelfHostedImageRepositoryPrefix;
    case 'docker-hub':
      return dockerHubSelfHostedImageRepositoryPrefix;
  }
}

function readSelfHostedRuntimeImageRegistryFromImageRef(imageRef: string): SelfHostedRuntimeImageRegistry | undefined {
  if (imageRef.startsWith(`${githubSelfHostedImageRepositoryPrefix}/`)) {
    return 'github';
  }
  if (imageRef.startsWith(`${dockerHubSelfHostedImageRepositoryPrefix}/`)) {
    return 'docker-hub';
  }

  return undefined;
}
