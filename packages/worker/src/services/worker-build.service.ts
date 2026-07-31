import {
  buildCompartmentArtifactImageRepository,
  buildCompartmentArtifactImageTag,
  type WorkerClaimedDeployment,
} from '@compartment/contracts';
import type { DockerBuildImageResult, DockerProgressLine, DockerRegistryCredentials } from '@compartment/docker';
import type { KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import {
  appendDeploymentLogLineSafely,
  appendDeploymentStepEventSafely,
  buildDeploymentEventContext,
} from './worker-deployment-event.service';
import type { WorkerDeploymentEventContext } from './worker-deployment-event.types';
import { readWorkerArtifactRegistryInternalHost } from '../worker-artifact-registry';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import type { WorkerConfig } from '../config';
import { buildCacheTag, issueBuildPushCredential } from '../registry-credentials';
import type { RegistryCredential } from '../registry-credentials.types';
import { decryptTenantSecretEnvironment } from '../tenant-secret-environment';
import { runWorkerBuildJob } from './worker-build-job.service';
import type { WorkerBuildJobDockerInput, WorkerSourceBuildJobInput } from './worker-build-job.types';
import { runTrackedDeploymentStep } from './worker-step-runner.service';

interface ReleaseImageBuildContext {
  config: WorkerConfig;
  deployment: WorkerClaimedDeployment;
  eventContext: WorkerDeploymentEventContext;
  request: CompartmentRequester;
  runtime: KubeRuntime;
}

interface PreparedBuildInput {
  imageTag: string;
  pushImageTag: string;
}

export async function buildReleaseImageFromSource(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  config: WorkerConfig,
  runtime: KubeRuntime,
): Promise<string> {
  const eventContext: WorkerDeploymentEventContext = buildDeploymentEventContext(request, deployment);
  await appendClaimedDeploymentEvent(eventContext);

  const existingImageRef: string | null = readReusableArtifactImageRef(deployment, config.artifactRegistry);
  if (existingImageRef !== null) {
    return existingImageRef;
  }

  return await buildFreshReleaseImage({
    config,
    deployment,
    eventContext,
    request,
    runtime,
  });
}

async function buildFreshReleaseImage(input: ReleaseImageBuildContext): Promise<string> {
  const imageTag: string = buildReleaseImageTag(input.deployment, input.config.artifactRegistry.address);
  const pushImageTag: string = buildReleaseImageTag(
    input.deployment,
    readWorkerArtifactRegistryInternalHost(input.config.artifactRegistry),
  );
  return await buildPreparedSourceImage(input, { imageTag, pushImageTag });
}

async function appendClaimedDeploymentEvent(eventContext: WorkerDeploymentEventContext): Promise<void> {
  await appendDeploymentStepEventSafely(eventContext, 'queued', 'succeeded', 'worker claimed deployment');
}

async function buildPreparedSourceImage(input: ReleaseImageBuildContext, build: PreparedBuildInput): Promise<string> {
  const buildResult: DockerBuildImageResult = await runTrackedDeploymentStep({
    eventContext: input.eventContext,
    failureSummary: 'image build failed',
    run: async (): Promise<DockerBuildImageResult> =>
      await runWorkerBuildJob(input.runtime, input.config.buildSandbox, {
        build: buildSourceJobInput(input, build),
        id: input.deployment.artifact.id,
        internalToken: input.config.runtimeControlToken,
        onProgressLine: createBuildProgressReporter(input.eventContext),
      }),
    startMessage: 'image build started',
    stepKey: 'building_image',
    successMessage: 'image build completed',
  });
  return readPushedPreparedSourceImageRef(buildResult, build.imageTag);
}

function buildSourceJobInput(input: ReleaseImageBuildContext, build: PreparedBuildInput): WorkerSourceBuildJobInput {
  const repository: string = buildReleaseImageRepository(input.deployment);
  const buildEnv: Record<string, string> = decryptTenantSecretEnvironment(
    input.deployment.buildEnv,
    input.config.tenantSecretsKek,
  );
  return {
    apiUrl: input.config.apiUrl,
    artifactId: input.deployment.artifact.id,
    docker: buildDockerJobInput(input, build, buildEnv, repository),
    kind: 'source',
    service: {
      build: input.deployment.service.build,
      kind: input.deployment.service.kind,
      name: input.deployment.service.name,
      path: input.deployment.service.path,
      requiresRoutesFile: input.deployment.requiresSourceRoutesFile,
      run: input.deployment.run,
    },
  };
}

function buildDockerJobInput(
  input: ReleaseImageBuildContext,
  build: PreparedBuildInput,
  buildEnv: Record<string, string>,
  repository: string,
): WorkerBuildJobDockerInput {
  const registry: WorkerArtifactRegistryConfig = input.config.artifactRegistry;
  return {
    ...(Object.keys(buildEnv).length === 0 ? {} : { buildEnv }),
    cacheImageRef: `${readWorkerArtifactRegistryInternalHost(registry)}/${repository}:${buildCacheTag}`,
    imageTag: build.imageTag,
    labels: buildReleaseImageLabels(input.deployment),
    pushImageInsecureRegistry: new URL(registry.internalUrl).protocol === 'http:',
    pushImageTag: build.pushImageTag,
    pushRegistryCredentials: buildPushRegistryCredentials(
      registry.credentialSigningKey,
      registry.internalAddress,
      input.deployment,
      repository,
    ),
  };
}

function buildPushRegistryCredentials(
  signingKey: string,
  registryAddress: string,
  deployment: WorkerClaimedDeployment,
  repository: string,
): DockerRegistryCredentials {
  const credential: RegistryCredential = issueBuildPushCredential(
    signingKey,
    deployment.projectId,
    repository,
    deployment.artifact.id,
  );
  return {
    password: credential.password,
    serverAddress: registryAddress,
    username: credential.username,
  };
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

function readPushedPreparedSourceImageRef(buildResult: DockerBuildImageResult, imageTag: string): string {
  if (buildResult.pushed && isDigestPinnedImageRef(buildResult.imageRef)) {
    return buildResult.imageRef;
  }

  throw new Error(`Expected source image build for "${imageTag}" to return a digest-pinned BuildKit push result.`);
}

function buildReleaseImageTag(deployment: WorkerClaimedDeployment, artifactRegistryAddress: string): string {
  return buildCompartmentArtifactImageTag(
    artifactRegistryAddress,
    buildReleaseImageRepository(deployment),
    deployment.artifact.id,
  );
}

function readReusableArtifactImageRef(
  deployment: WorkerClaimedDeployment,
  artifactRegistry: WorkerArtifactRegistryConfig,
): string | null {
  const imageRef: string | null = deployment.artifact.imageRef;
  const expectedRepository: string = `${artifactRegistry.address}/${buildReleaseImageRepository(deployment)}`;
  return imageRef !== null && imageRef.startsWith(`${expectedRepository}@sha256:`) && isDigestPinnedImageRef(imageRef)
    ? imageRef
    : null;
}

function buildReleaseImageRepository(deployment: WorkerClaimedDeployment): string {
  return buildCompartmentArtifactImageRepository(deployment.projectId, deployment.service.id);
}

function isDigestPinnedImageRef(imageRef: string): boolean {
  return /@sha256:[a-f0-9]{64}$/u.test(imageRef);
}
