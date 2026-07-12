import { basename, dirname, join } from 'node:path';
import { readDockerfileBuildPath } from './docker-build-args';
import { buildRailpackSecretsHash, buildRailpackSecretArgs } from './docker-build-secrets';
import { railpackFrontendImage } from './railpack-frontend-image';
import type {
  BuildKitDockerfileBuildctlInput,
  BuildKitDockerfilePaths,
  BuildKitRailpackBuildctlInput,
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
    '--opt',
    'attest:sbom=',
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
    '--opt',
    'attest:sbom=',
    '--output',
    buildImageOutput(input.input.pushImageTag ?? input.input.imageTag, input.input.pushImageInsecureRegistry),
    '--metadata-file',
    input.metadataFile,
  ];
}

export function buildRailpackToolchainBuildctlArgs(input: BuildKitRailpackBuildctlInput): string[] {
  return [
    '--addr',
    input.buildKitAddress,
    'build',
    ...buildRailpackFrontendArgs(input.contextDirectory, input.dockerfileDirectory),
    ...buildOptionalOutputArgs(input.output),
  ];
}

export function buildBuildKitPruneArgs(buildKitAddress: string): string[] {
  return ['--addr', buildKitAddress, 'prune', '--all', '--keep-duration', '24h', '--keep-storage', '2000'];
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
  return `type=image,name=${imageTag},push=true,oci-mediatypes=true,oci-artifact=true${
    insecureRegistry === true ? ',registry.insecure=true' : ''
  }`;
}

function buildOptionalOutputArgs(output: string | undefined): string[] {
  return output === undefined ? [] : ['--output', output];
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
