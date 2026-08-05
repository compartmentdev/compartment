import { basename, dirname, join } from 'node:path';
import { readDockerfileBuildPath } from './docker-build-args';
import { buildRailpackSecretsHash, buildRailpackSecretArgs } from './docker-build-secrets';
import { railpackFrontendImage } from './railpack-frontend-image';
import type {
  BuildKitDockerfileBuildctlInput,
  BuildKitDockerfilePaths,
  BuildKitRailpackImageBuildctlInput,
} from './docker-buildkit.types';
import type { DockerBuildImageInput } from './docker-models';

export function buildDockerfileBuildctlArgs(input: BuildKitDockerfileBuildctlInput): string[] {
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
    ...buildBuildKitBuildArgOpts(input.input.buildEnv),
    ...buildBuildKitLabelOpts(input.input.labels),
    ...buildBuildKitCacheArgs(input.input),
    '--output',
    buildImageOutput(input.input.pushImageTag ?? input.input.imageTag, input.input.pushImageInsecureRegistry),
    '--metadata-file',
    input.metadataFile,
  ];
}

export function buildRailpackImageBuildctlArgs(input: BuildKitRailpackImageBuildctlInput): string[] {
  return [
    ...buildBuildctlPrefixArgs(input.buildKitAddress, input.input),
    ...buildRailpackFrontendArgs(input.input.contextDirectory, input.railpackDirectory),
    ...buildBuildKitLabelOpts(input.input.labels),
    ...buildRailpackSecretsHashOpt(input.railpackSecrets.railpackConfigEnv),
    ...buildRailpackSecretArgs(input.railpackSecrets.secretFiles),
    ...buildBuildKitCacheArgs(input.input),
    '--output',
    buildImageOutput(input.input.pushImageTag ?? input.input.imageTag, input.input.pushImageInsecureRegistry),
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

function buildBuildKitBuildArgOpts(buildEnv: Record<string, string> | undefined): string[] {
  return Object.entries(buildEnv ?? {}).flatMap(([name, value]: [string, string]): string[] => [
    '--opt',
    `build-arg:${name}=${value}`,
  ]);
}

function buildBuildKitLabelOpts(labels: Record<string, string> | undefined): string[] {
  return Object.entries(labels ?? {}).flatMap(([name, value]: [string, string]): string[] => [
    '--opt',
    `label:${name}=${value}`,
  ]);
}

function buildRailpackSecretsHashOpt(buildEnv: Record<string, string>): string[] {
  const secretsHash: string | null = buildRailpackSecretsHash(buildEnv);

  return secretsHash === null ? [] : ['--opt', `secrets-hash=${secretsHash}`];
}

function buildImageOutput(imageTag: string, insecureRegistry: boolean | undefined): string {
  return `type=image,name=${imageTag},push=true,oci-mediatypes=true${
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
    `type=registry,ref=${input.cacheImageRef},mode=min,image-manifest=true,oci-mediatypes=true${insecure}`,
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
