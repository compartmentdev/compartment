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

interface BuildReleaseFromPreparedSourceInput {
  archiveRequest: CompartmentBinaryRequester;
  artifactRegistry: WorkerArtifactRegistryConfig;
  deployment: WorkerClaimedDeployment;
  eventContext: WorkerDeploymentEventContext;
  imageTag: string;
  pushImageTag: string;
  request: CompartmentRequester;
  tempDirectory: string;
}

interface FreshReleaseImageFromSourceInput {
  archiveRequest: CompartmentBinaryRequester;
  artifactRegistry: WorkerArtifactRegistryConfig;
  deployment: WorkerClaimedDeployment;
  eventContext: WorkerDeploymentEventContext;
  imageTag: string;
  pushImageTag: string;
  request: CompartmentRequester;
}

interface BuildPreparedSourceImageInput {
  artifactRegistry: WorkerArtifactRegistryConfig;
  deployment: WorkerClaimedDeployment;
  eventContext: WorkerDeploymentEventContext;
  imageTag: string;
  preparedSource: PreparedWorkerSource;
  pushImageTag: string;
  request: CompartmentRequester;
}

export async function buildReleaseImageFromSource(
  request: CompartmentRequester,
  archiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  artifactRegistry: WorkerArtifactRegistryConfig,
): Promise<string> {
  const eventContext: WorkerDeploymentEventContext = buildDeploymentEventContext(request, deployment);
  await appendClaimedDeploymentEvent(eventContext);

  const existingImageRef: string | null = readReusableArtifactImageRef(deployment);
  if (existingImageRef !== null) {
    return existingImageRef;
  }

  return await buildFreshReleaseImageFromSource({
    request,
    archiveRequest,
    deployment,
    imageTag: buildReleaseImageTag(deployment, artifactRegistry.address),
    pushImageTag: buildReleaseImageTag(deployment, readWorkerArtifactRegistryInternalHost(artifactRegistry)),
    eventContext,
    artifactRegistry,
  });
}

async function buildFreshReleaseImageFromSource(input: FreshReleaseImageFromSourceInput): Promise<string> {
  const tempDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-worker-'));

  try {
    return await buildReleaseFromPreparedSource({
      archiveRequest: input.archiveRequest,
      artifactRegistry: input.artifactRegistry,
      deployment: input.deployment,
      eventContext: input.eventContext,
      imageTag: input.imageTag,
      pushImageTag: input.pushImageTag,
      request: input.request,
      tempDirectory,
    });
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function buildReleaseFromPreparedSource(input: BuildReleaseFromPreparedSourceInput): Promise<string> {
  const preparedSource: PreparedWorkerSource = await prepareRunnableDeploymentSource(
    input.eventContext,
    input.archiveRequest,
    input.deployment,
    input.tempDirectory,
  );
  return await buildAndPublishPreparedSourceImage(
    input.eventContext,
    input.request,
    preparedSource,
    input.deployment,
    input.artifactRegistry,
    input.imageTag,
    input.pushImageTag,
  );
}

async function prepareRunnableDeploymentSource(
  eventContext: WorkerDeploymentEventContext,
  archiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  tempDirectory: string,
): Promise<PreparedWorkerSource> {
  const preparedSource: PreparedWorkerSource = await prepareDeploymentSource(
    eventContext,
    archiveRequest,
    deployment,
    tempDirectory,
  );
  resolveCompartmentServiceRunExecution(deployment.run, preparedSource.packer, deployment.service.path);
  return preparedSource;
}

async function buildAndPublishPreparedSourceImage(
  eventContext: WorkerDeploymentEventContext,
  request: CompartmentRequester,
  preparedSource: PreparedWorkerSource,
  deployment: WorkerClaimedDeployment,
  artifactRegistry: WorkerArtifactRegistryConfig,
  imageTag: string,
  pushImageTag: string,
): Promise<string> {
  const buildResult: DockerBuildImageResult = await buildPreparedSourceImage({
    artifactRegistry,
    deployment,
    eventContext,
    imageTag,
    preparedSource,
    pushImageTag,
    request,
  });
  return readPushedPreparedSourceImageRef(buildResult, imageTag);
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

async function buildPreparedSourceImage(input: BuildPreparedSourceImageInput): Promise<DockerBuildImageResult> {
  return await runTrackedDeploymentStep({
    eventContext: input.eventContext,
    failureSummary: 'image build failed',
    run: async (): Promise<DockerBuildImageResult> =>
      await scheduleWorkerBuild(
        async (): Promise<DockerBuildImageResult> =>
          await buildDockerImage(
            buildDockerImageInput({
              artifactRegistry: input.artifactRegistry,
              deployment: input.deployment,
              imageTag: input.imageTag,
              preparedSource: input.preparedSource,
              pushImageTag: input.pushImageTag,
              request: input.request,
            }),
          ),
      ),
    startMessage: 'image build started',
    stepKey: 'building_image',
    successMessage: 'image build completed',
  });
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

function buildReleaseImageRepository(deployment: WorkerClaimedDeployment): string {
  return buildCompartmentArtifactImageRepository(deployment.projectId, deployment.service.id);
}

function readReusableArtifactImageRef(deployment: WorkerClaimedDeployment): string | null {
  const imageRef: string | null = deployment.artifact.imageRef;
  return imageRef !== null && isDigestPinnedImageRef(imageRef) ? imageRef : null;
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
