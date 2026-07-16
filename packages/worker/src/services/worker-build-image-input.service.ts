import { type WorkerClaimedDeployment } from '@compartment/contracts';
import {
  type DockerBuildImageInput,
  type DockerProgressLine,
  type DockerRegistryCredentials,
} from '@compartment/docker';
import type { CompartmentRequester } from '@compartment/sdk';
import { readWorkerArtifactRegistryInternalHost } from '../worker-artifact-registry';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import { appendDeploymentLogLineSafely, buildDeploymentEventContext } from './worker-deployment-event.service';
import type { WorkerDeploymentEventContext } from './worker-deployment-event.types';
import type { PreparedWorkerSource } from './worker-source.service.types';

class WorkerDockerBuildImageInput implements DockerBuildImageInput {
  appPath?: string | undefined;
  buildAptPackages?: string[] | undefined;
  buildCommand?: string | undefined;
  buildEnv?: Record<string, string> | undefined;
  contextDirectory!: string;
  dockerfilePath?: string | undefined;
  imageTag!: string;
  labels?: Record<string, string> | undefined;
  onProgressLine?: ((line: DockerProgressLine) => void | Promise<void>) | undefined;
  packer!: 'dockerfile' | 'railpack' | 'static';
  pushImageInsecureRegistry?: boolean | undefined;
  pushImageTag?: string | undefined;
  pushRegistryCredentials?: DockerRegistryCredentials | undefined;
  runtimeAptPackages?: string[] | undefined;
  staticOutputDirectory?: string | undefined;

  constructor(input: DockerBuildImageInput) {
    Object.assign(this, input);
  }
}

interface BuildDockerImageInputRequest {
  artifactRegistry: WorkerArtifactRegistryConfig;
  deployment: WorkerClaimedDeployment;
  imageTag: string;
  preparedSource: PreparedWorkerSource;
  pushImageTag: string;
  request: CompartmentRequester;
}

export function buildDockerImageInput(input: BuildDockerImageInputRequest): DockerBuildImageInput {
  const buildEnv: Record<string, string> | undefined = buildSourceBuildEnv(input.deployment);

  return new WorkerDockerBuildImageInput({
    ...readPreparedSourceBuildInput(input.preparedSource, input.deployment),
    ...(input.preparedSource.buildAptPackages.length > 0
      ? { buildAptPackages: input.preparedSource.buildAptPackages }
      : {}),
    ...(input.preparedSource.buildCommand !== undefined ? { buildCommand: input.preparedSource.buildCommand } : {}),
    ...(buildEnv !== undefined ? { buildEnv } : {}),
    contextDirectory: input.preparedSource.buildContextDirectory,
    ...(input.preparedSource.dockerfilePath !== undefined
      ? { dockerfilePath: input.preparedSource.dockerfilePath }
      : {}),
    imageTag: input.imageTag,
    labels: buildReleaseImageLabels(input.deployment),
    onProgressLine: createBuildProgressReporter(buildDeploymentEventContext(input.request, input.deployment)),
    packer: input.preparedSource.packer,
    pushImageInsecureRegistry: input.artifactRegistry.mode === 'bundled',
    pushImageTag: input.pushImageTag,
    pushRegistryCredentials: buildPushRegistryCredentials(input.artifactRegistry),
    ...(input.preparedSource.runtimeAptPackages.length > 0
      ? { runtimeAptPackages: input.preparedSource.runtimeAptPackages }
      : {}),
  });
}

function buildPushRegistryCredentials(artifactRegistry: WorkerArtifactRegistryConfig): DockerRegistryCredentials {
  return {
    password: artifactRegistry.writeCredentials.password,
    serverAddress: readWorkerArtifactRegistryInternalHost(artifactRegistry),
    username: artifactRegistry.writeCredentials.username,
  };
}

function readPreparedSourceBuildInput(
  preparedSource: PreparedWorkerSource,
  deployment: WorkerClaimedDeployment,
): Partial<Pick<DockerBuildImageInput, 'appPath' | 'staticOutputDirectory'>> {
  if (preparedSource.packer === 'dockerfile') {
    return {};
  }

  return deployment.service.kind === 'static'
    ? requirePreparedStaticSourceBuildInput(preparedSource)
    : (preparedSource.sourceBuildInput ?? {});
}

function buildSourceBuildEnv(deployment: WorkerClaimedDeployment): Record<string, string> | undefined {
  const buildEnv: Record<string, string> = { ...deployment.buildEnv };
  return Object.keys(buildEnv).length > 0 ? buildEnv : undefined;
}

function createBuildProgressReporter(context: WorkerDeploymentEventContext): (line: DockerProgressLine) => void {
  return (line: DockerProgressLine): void => {
    void appendDeploymentLogLineSafely(context, 'building_image', line.stream, line.message, 'info');
  };
}

function buildReleaseImageLabels(deployment: WorkerClaimedDeployment): Record<string, string> {
  return {
    'compartment.artifactId': deployment.artifact.id,
    'compartment.environment': deployment.environmentName,
    'compartment.project': deployment.projectName,
    'compartment.service': deployment.service.name,
  };
}

function requirePreparedStaticSourceBuildInput(
  preparedSource: PreparedWorkerSource,
): Partial<Pick<DockerBuildImageInput, 'appPath' | 'staticOutputDirectory'>> {
  if (preparedSource.sourceBuildInput?.staticOutputDirectory !== undefined) {
    return preparedSource.sourceBuildInput;
  }

  throw new Error('Static services must resolve build.outputDirectory before image build.');
}
