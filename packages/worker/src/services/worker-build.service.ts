import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCompartmentArtifactImageRepository,
  buildCompartmentArtifactImageTag,
  resolveCompartmentServiceRunExecution,
  type WorkerClaimedDeployment,
} from '@compartment/contracts';
import { buildDockerImage, type DockerBuildImageResult } from '@compartment/docker';
import { type CompartmentBinaryRequester, type CompartmentRequester, getArtifactSourceArchive } from '@compartment/sdk';
import { appendDeploymentStepEventSafely, buildDeploymentEventContext } from './worker-deployment-event.service';
import type { WorkerDeploymentEventContext } from './worker-deployment-event.types';
import { readWorkerArtifactRegistryInternalHost } from '../worker-artifact-registry';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import { buildDockerImageInput } from './worker-build-image-input.service';
import { scheduleWorkerBuild } from './worker-build-scheduler.service';
import { prepareServiceDirectory } from './worker-source.service';
import type { PreparedWorkerSource, WorkerSourceServiceInput } from './worker-source.service.types';
import { runTrackedDeploymentStep } from './worker-step-runner.service';
import type { TenantSecretsKeyring } from '../tenant-secret-environment.types';

interface ReleaseImageBuildContext {
  artifactRegistry: WorkerArtifactRegistryConfig;
  deployment: WorkerClaimedDeployment;
  eventContext: WorkerDeploymentEventContext;
  request: CompartmentRequester;
  tenantSecretsKek: TenantSecretsKeyring;
}

interface PreparedBuildInput {
  imageTag: string;
  preparedSource: PreparedWorkerSource;
  pushImageTag: string;
}

export async function buildReleaseImageFromSource(
  request: CompartmentRequester,
  archiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  artifactRegistry: WorkerArtifactRegistryConfig,
  tenantSecretsKek: TenantSecretsKeyring,
): Promise<string> {
  const eventContext: WorkerDeploymentEventContext = buildDeploymentEventContext(request, deployment);
  await appendClaimedDeploymentEvent(eventContext);

  const existingImageRef: string | null = readReusableArtifactImageRef(deployment, artifactRegistry);
  if (existingImageRef !== null) {
    return existingImageRef;
  }

  return await buildFreshReleaseImage(archiveRequest, {
    artifactRegistry,
    deployment,
    eventContext,
    request,
    tenantSecretsKek,
  });
}

async function buildFreshReleaseImage(
  archiveRequest: CompartmentBinaryRequester,
  input: ReleaseImageBuildContext,
): Promise<string> {
  const imageTag: string = buildReleaseImageTag(input.deployment, input.artifactRegistry.address);
  const pushImageTag: string = buildReleaseImageTag(
    input.deployment,
    readWorkerArtifactRegistryInternalHost(input.artifactRegistry),
  );
  const tempDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-worker-'));

  try {
    const preparedSource: PreparedWorkerSource = await prepareDeploymentSource(
      input.eventContext,
      archiveRequest,
      input.deployment,
      tempDirectory,
    );
    resolveCompartmentServiceRunExecution(input.deployment.run, preparedSource.packer, input.deployment.service.path);
    return await buildPreparedSourceImage(input, { imageTag, preparedSource, pushImageTag });
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function prepareDeploymentSource(
  eventContext: WorkerDeploymentEventContext,
  archiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  tempDirectory: string,
): Promise<PreparedWorkerSource> {
  return await runTrackedDeploymentStep({
    eventContext,
    failureSummary: 'source preparation failed',
    run: async (): Promise<PreparedWorkerSource> =>
      await readPreparedDeploymentSource(archiveRequest, deployment, tempDirectory),
    startMessage: 'preparing source archive',
    stepKey: 'preparing_source',
    successMessage: 'source archive prepared',
  });
}

async function appendClaimedDeploymentEvent(eventContext: WorkerDeploymentEventContext): Promise<void> {
  await appendDeploymentStepEventSafely(eventContext, 'queued', 'succeeded', 'worker claimed deployment');
}

async function buildPreparedSourceImage(input: ReleaseImageBuildContext, build: PreparedBuildInput): Promise<string> {
  const buildResult: DockerBuildImageResult = await runTrackedDeploymentStep({
    eventContext: input.eventContext,
    failureSummary: 'image build failed',
    run: async (): Promise<DockerBuildImageResult> =>
      await scheduleWorkerBuild(
        async (): Promise<DockerBuildImageResult> =>
          await buildDockerImage(
            buildDockerImageInput({
              artifactRegistry: input.artifactRegistry,
              deployment: input.deployment,
              imageTag: build.imageTag,
              preparedSource: build.preparedSource,
              pushImageTag: build.pushImageTag,
              request: input.request,
              tenantSecretsKek: input.tenantSecretsKek,
            }),
          ),
      ),
    startMessage: 'image build started',
    stepKey: 'building_image',
    successMessage: 'image build completed',
  });
  return readPushedPreparedSourceImageRef(buildResult, build.imageTag);
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

async function readPreparedDeploymentSource(
  archiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  tempDirectory: string,
): Promise<PreparedWorkerSource> {
  const sourceArchive: Buffer = await getArtifactSourceArchive(archiveRequest, deployment.artifact.id);
  return await prepareServiceDirectory(
    tempDirectory,
    sourceArchive,
    buildWorkerSourceServiceInput(deployment),
    deployment.service.build,
    deployment.requiresSourceRoutesFile,
  );
}

function buildWorkerSourceServiceInput(deployment: WorkerClaimedDeployment): WorkerSourceServiceInput {
  return {
    kind: deployment.service.kind,
    name: deployment.service.name,
    path: deployment.service.path,
  };
}
