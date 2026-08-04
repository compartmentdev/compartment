import { basename, dirname, join } from 'node:path';
import { readDockerfileBuildPath } from './docker-build-args';
import {
  isKeyedSha256Fingerprint,
  requireRailpackSecretsFingerprint,
  buildRailpackSecretArgs,
} from './docker-build-secrets';
import { railpackFrontendImage } from './railpack-frontend-image';
import type {
  BuildKitDockerfileBuildctlInput,
  BuildKitDockerfilePaths,
  BuildKitRailpackImageBuildctlInput,
} from './docker-buildkit.types';
import type { DockerBuildImageInput } from './docker-models';

const buildPlatform: string = 'linux/amd64';

export function buildDockerfileBuildctlArgs(input: BuildKitDockerfileBuildctlInput): string[] {
  assertDockerfileBuildHasNoSecrets(input.input.buildEnv);
  const dockerfilePaths: BuildKitDockerfilePaths = readBuildKitDockerfilePaths(input.input);

  return [
    ...buildBuildctlPrefixArgs(input.buildKitAddress, input.input),
    '--frontend',
    'dockerfile.v0',
    '--local',
    `context=${input.input.contextDirectory}`,
    '--local',
    `dockerfile=${dockerfilePaths.dockerfileDirectory}`,
    '--opt',
    `filename=${dockerfilePaths.dockerfileName}`,
    '--opt',
    `platform=${buildPlatform}`,
    ...buildBuildKitLabelOpts(input.input.labels),
    ...buildBuildKitCacheArgs(input.input),
    ...buildBuildKitOutputArgs(input.input),
    '--metadata-file',
    input.metadataFile,
  ];
}

function buildBuildKitLabelOpts(labels: Record<string, string> | undefined): string[] {
  return Object.entries(labels ?? {}).flatMap(([name, value]: [string, string]): string[] => [
    '--opt',
    `label:${name}=${value}`,
  ]);
}

export function buildRailpackImageBuildctlArgs(input: BuildKitRailpackImageBuildctlInput): string[] {
  return [
    ...buildBuildctlPrefixArgs(input.buildKitAddress, input.input),
    ...buildRailpackFrontendArgs(input.input.contextDirectory, input.railpackDirectory),
    '--opt',
    `platform=${buildPlatform}`,
    ...buildRailpackCacheOpts(
      input.input.buildCacheKey,
      input.railpackSecrets.railpackConfigEnv,
      input.input.buildSecretFingerprint,
    ),
    ...buildRailpackSecretArgs(input.railpackSecrets.secretFiles),
    ...buildBuildKitCacheArgs(input.input),
    ...buildBuildKitOutputArgs(input.input),
    '--metadata-file',
    input.metadataFile,
  ];
}

function buildBuildctlPrefixArgs(buildKitAddress: string, input: DockerBuildImageInput): string[] {
  return ['--addr', buildKitAddress, 'build', ...(input.onProgressLine !== undefined ? ['--progress=plain'] : [])];
}

function buildRailpackFrontendArgs(contextDirectory: string, dockerfileDirectory: string): string[] {
  return [
    '--frontend',
    'gateway.v0',
    '--local',
    `context=${contextDirectory}`,
    '--local',
    `dockerfile=${dockerfileDirectory}`,
    '--opt',
    `source=${railpackFrontendImage}`,
  ];
}

function assertDockerfileBuildHasNoSecrets(buildEnv: Record<string, string> | undefined): void {
  if (buildEnv !== undefined && Object.keys(buildEnv).length > 0) {
    throw new Error('Dockerfile builds do not support build secrets; use a Railpack source build.');
  }
}

function buildRailpackCacheOpts(
  cacheKey: string | undefined,
  buildEnv: Record<string, string>,
  fingerprint: string | undefined,
): string[] {
  const secretsFingerprint: string | null = requireRailpackSecretsFingerprint(buildEnv, fingerprint);
  const cacheFingerprint: string | null = readOptionalCacheFingerprint(cacheKey);

  return [
    ...(cacheFingerprint === null ? [] : ['--opt', `build-arg:cache-key=${cacheFingerprint}`]),
    ...(secretsFingerprint === null ? [] : ['--opt', `build-arg:secrets-hash=${secretsFingerprint}`]),
  ];
}

function readOptionalCacheFingerprint(fingerprint: string | undefined): string | null {
  if (fingerprint === undefined) {
    return null;
  }
  if (!isKeyedSha256Fingerprint(fingerprint)) {
    throw new Error('Build cache fingerprints must be keyed SHA-256 values.');
  }
  return fingerprint;
}

function buildBuildKitOutputArgs(input: DockerBuildImageInput): string[] {
  return ['--output', buildImageOutput(input.pushImageTag ?? input.imageTag, input.pushImageInsecureRegistry)];
}

function buildImageOutput(imageTag: string, insecureRegistry: boolean | undefined): string {
  return `type=image,name=${imageTag},push=true,oci-mediatypes=true,oci-artifact=true${
    insecureRegistry === true ? ',registry.insecure=true' : ''
  }`;
}

function buildBuildKitCacheArgs(input: DockerBuildImageInput): string[] {
  if (input.cacheImageRef === undefined) {
    return [];
  }
  const insecure: string = input.pushImageInsecureRegistry === true ? ',registry.insecure=true' : '';
  return [
    '--import-cache',
    `type=registry,ref=${input.cacheImageRef}${insecure}`,
    '--export-cache',
    `type=registry,ref=${input.cacheImageRef},mode=max,image-manifest=true,oci-mediatypes=true${insecure}`,
  ];
}

function readBuildKitDockerfilePaths(input: DockerBuildImageInput): BuildKitDockerfilePaths {
  const dockerfilePath: string = readBuildKitDockerfileBuildPath(input);

  return {
    dockerfileDirectory: dirname(dockerfilePath),
    dockerfileName: basename(dockerfilePath),
  };
}

function readBuildKitDockerfileBuildPath(input: DockerBuildImageInput): string {
  if (input.dockerfilePath === undefined) {
    return join(input.contextDirectory, 'Dockerfile');
  }

  return readDockerfileBuildPath(input);
}
