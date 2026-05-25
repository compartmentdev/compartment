import { readRequiredSelfHostedEnvironmentValue, readSelfHostedEnvironmentValues } from './self-hosted-env-file';
import type { SelfHostedImageRefs, SelfHostedRuntimeSelection } from './self-hosted-env.types';

const selfHostedImageRepositoryPrefix: string = 'docker.io/compartmentdev';
const runtimeProbeImageVariableName: string = 'COMPARTMENT_RUNTIME_PROBE_IMAGE';

export function buildPublishedSelfHostedRuntimeSelection(releaseVersion: string): SelfHostedRuntimeSelection {
  return {
    imageRefs: buildSelfHostedImageRefs(releaseVersion),
    nodeVersion: releaseVersion,
  };
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

function buildSelfHostedImageRefs(releaseVersion: string): SelfHostedImageRefs {
  return {
    apiImage: buildSelfHostedImageRef('api', releaseVersion),
    caddyImage: buildSelfHostedImageRef('caddy', releaseVersion),
    edgeImage: buildSelfHostedImageRef('edge', releaseVersion),
    runtimeProbeImage: buildSelfHostedImageRef('runtime-probe', releaseVersion),
    workerImage: buildSelfHostedImageRef('worker', releaseVersion),
  };
}

function buildSelfHostedImageRef(serviceName: string, tag: string): string {
  return `${selfHostedImageRepositoryPrefix}/compartment-${serviceName}:${tag}`;
}
