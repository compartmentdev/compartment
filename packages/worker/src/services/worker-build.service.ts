import { createHmac, type Hmac } from 'node:crypto';
import {
  buildCompartmentArtifactImageRepository,
  buildCompartmentArtifactImageTag,
  retargetCompartmentArtifactImageDigestRef,
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
import { isManifestDigest } from '../registry-manifest-reference';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import type { WorkerConfig } from '../config';
import { buildCacheTag, issueBuildPullCredential, issueBuildPushCredential } from '../registry-credentials';
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
        jobToken: input.deployment.buildJobToken,
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
    buildCacheKey: buildTenantCacheKey(input),
    ...(Object.keys(buildEnv).length === 0 ? {} : { buildEnv }),
    buildSecretFingerprint: buildTenantSecretFingerprint(input, buildEnv),
    cacheImageRef: `${readWorkerArtifactRegistryInternalHost(registry)}/${repository}:${buildCacheTag}`,
    imageTag: build.imageTag,
    pushImageInsecureRegistry: new URL(registry.internalUrl).protocol === 'http:',
    pushImageTag: build.pushImageTag,
    pushRegistryCredentials: buildPushRegistryCredentials(
      registry.credentialSigningKey,
      registry.internalAddress,
      input.deployment,
      repository,
    ),
    scanRegistryCredentials: buildScanRegistryCredentials(input, repository),
  };
}

function buildTenantCacheKey(input: ReleaseImageBuildContext): string {
  return createHmac('sha256', input.config.tenantSecretsKek.current)
    .update('compartment:build-cache-key:v1')
    .update('\0')
    .update(input.deployment.projectId)
    .update('\0')
    .update(input.deployment.service.id)
    .digest('hex');
}

function buildScanRegistryCredentials(input: ReleaseImageBuildContext, repository: string): DockerRegistryCredentials {
  const credential: RegistryCredential = issueBuildPullCredential(
    input.config.artifactRegistry.credentialSigningKey,
    input.deployment.projectId,
    repository,
  );
  return {
    password: credential.password,
    serverAddress: input.config.artifactRegistry.internalAddress,
    username: credential.username,
  };
}

function buildTenantSecretFingerprint(input: ReleaseImageBuildContext, buildEnv: Record<string, string>): string {
  const fingerprint: Hmac = createHmac('sha256', input.config.tenantSecretsKek.current)
    .update('compartment:build-cache-secret:v1')
    .update('\0')
    .update(input.deployment.projectId)
    .update('\0')
    .update(JSON.stringify(input.deployment.service.build))
    .update('\0');
  for (const [name, value] of Object.entries(buildEnv).sort(
    ([left]: [string, string], [right]: [string, string]): number => left.localeCompare(right),
  )) {
    fingerprint.update(name).update('\0').update(value).update('\0');
  }
  return fingerprint.digest('hex');
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

function createBuildProgressReporter(
  context: WorkerDeploymentEventContext,
): (line: DockerProgressLine) => Promise<void> {
  return async (line: DockerProgressLine): Promise<void> =>
    await appendDeploymentLogLineSafely(context, 'building_image', line.stream, line.message, 'info');
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
  if (deployment.artifact.buildState !== 'ready' || imageRef === null) {
    return null;
  }
  return retargetCompartmentArtifactImageDigestRef(
    artifactRegistry.address,
    buildReleaseImageRepository(deployment),
    imageRef,
  );
}

function buildReleaseImageRepository(deployment: WorkerClaimedDeployment): string {
  return buildCompartmentArtifactImageRepository(deployment.projectId, deployment.service.id);
}

function isDigestPinnedImageRef(imageRef: string): boolean {
  const separatorIndex: number = imageRef.lastIndexOf('@');
  return separatorIndex > 0 && isManifestDigest(imageRef.slice(separatorIndex + 1));
}
