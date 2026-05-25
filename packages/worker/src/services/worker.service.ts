import type { WorkerClaimDeploymentResponse, WorkerClaimedDeployment } from '@compartment/contracts';
import {
  claimNextDeployment,
  type CompartmentRequester,
  createCompartmentBinaryRequester,
  createCompartmentRawRequester,
  createCompartmentRequester,
  failDeployment,
  isCompartmentRequestError,
  type CompartmentBinaryRequester,
  type CompartmentRawRequester,
} from '@compartment/sdk';
import { buildReleaseImageFromSource } from './worker-build.service';
import { appendRuntimeStepEventSafely, buildDeploymentEventContext } from './worker-deployment-tracking.service';
import { runGitSourceResolutionIteration } from './worker-git-source-resolution.service';
import { runGitSourceSyncIteration } from './worker-git-source-sync.service';
import { runScheduledResourceOperationIteration } from './worker-resource-operation-scheduler.service';
import { completeBuiltDeployment } from './worker-runtime-deploy.service';
import { readWorkerFailureMessage } from './worker-failure-message.service';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import type {
  AttemptClaimedDeploymentCompletionInput,
  AttemptedClaimedDeploymentResult,
  WorkerRequesterInput,
} from './worker-iteration.types';

export async function runWorkerIteration(
  apiUrl: string,
  runtimeControlToken: string,
  dockerNamespace: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
): Promise<boolean> {
  const requesterInput: WorkerRequesterInput = { apiUrl, internalToken: runtimeControlToken };
  const request: CompartmentRequester = createCompartmentRequester(requesterInput);
  const releaseArchiveRequest: CompartmentBinaryRequester = createCompartmentBinaryRequester(requesterInput);
  const rawRequest: CompartmentRawRequester = createCompartmentRawRequester(requesterInput);
  return await runWorkerIterationWithClients(
    request,
    releaseArchiveRequest,
    rawRequest,
    dockerNamespace,
    artifactRegistry,
    runtimeControlToken,
  );
}

async function runWorkerIterationWithClients(
  request: CompartmentRequester,
  releaseArchiveRequest: CompartmentBinaryRequester,
  rawRequest: CompartmentRawRequester,
  dockerNamespace: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
  runtimeControlToken: string,
): Promise<boolean> {
  return (
    (await runGitSourceResolutionIteration(request, rawRequest)) ||
    (await runScheduledResourceOperationIteration(request)) ||
    (await handleClaimedDeploymentOrContinue(
      request,
      releaseArchiveRequest,
      dockerNamespace,
      artifactRegistry,
      runtimeControlToken,
    )) ||
    (await runGitSourceSyncIteration(request))
  );
}

async function handleClaimedDeploymentOrContinue(
  request: CompartmentRequester,
  releaseArchiveRequest: CompartmentBinaryRequester,
  dockerNamespace: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
  runtimeControlToken: string,
): Promise<boolean> {
  const claimed: WorkerClaimDeploymentResponse = await claimNextDeployment(request);
  return await handleClaimedDeployment(
    request,
    releaseArchiveRequest,
    claimed,
    dockerNamespace,
    artifactRegistry,
    runtimeControlToken,
  );
}

async function handleClaimedDeployment(
  request: CompartmentRequester,
  releaseArchiveRequest: CompartmentBinaryRequester,
  claimed: WorkerClaimDeploymentResponse,
  dockerNamespace: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
  runtimeControlToken: string,
): Promise<boolean> {
  if (claimed.deployment === null) {
    return false;
  }

  return await completeAndPersistClaimedDeployment(
    request,
    releaseArchiveRequest,
    claimed.deployment,
    dockerNamespace,
    artifactRegistry,
    runtimeControlToken,
  );
}

async function completeAndPersistClaimedDeployment(
  request: CompartmentRequester,
  releaseArchiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  dockerNamespace: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
  runtimeControlToken: string,
): Promise<boolean> {
  const result: AttemptedClaimedDeploymentResult = await attemptClaimedDeploymentCompletion({
    artifactRegistry,
    deployment,
    dockerNamespace,
    releaseArchiveRequest,
    request,
    runtimeControlToken,
  });
  if (result.failureError === undefined) {
    return true;
  }

  return await reportWorkerIterationFailure(request, deployment, result.failureError, result.imageRef);
}

async function attemptClaimedDeploymentCompletion(
  input: Readonly<AttemptClaimedDeploymentCompletionInput>,
): Promise<AttemptedClaimedDeploymentResult> {
  const { artifactRegistry, deployment, dockerNamespace, releaseArchiveRequest, request } = input;
  let imageRef: string | undefined;
  try {
    const builtImageRef: string = await buildClaimedDeploymentImage(
      request,
      releaseArchiveRequest,
      deployment,
      dockerNamespace,
      artifactRegistry,
    );
    imageRef = builtImageRef;
    await completeAttemptedClaimedDeployment(input, builtImageRef);
    return buildAttemptedClaimedDeploymentSuccessResult(imageRef);
  } catch (error) {
    return buildAttemptedClaimedDeploymentFailureResult(error instanceof Error ? error : undefined, imageRef);
  }
}

async function completeAttemptedClaimedDeployment(
  input: Readonly<AttemptClaimedDeploymentCompletionInput>,
  imageRef: string,
): Promise<void> {
  await completeClaimedDeployment(
    input.request,
    input.deployment,
    imageRef,
    input.artifactRegistry,
    input.dockerNamespace,
    input.runtimeControlToken,
  );
}

async function completeClaimedDeployment(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
  dockerNamespace: string,
  runtimeControlToken: string,
): Promise<void> {
  await completeBuiltDeployment(request, deployment, imageRef, artifactRegistry, dockerNamespace, runtimeControlToken);
}

function buildAttemptedClaimedDeploymentSuccessResult(imageRef: string): AttemptedClaimedDeploymentResult {
  return { imageRef };
}

function buildAttemptedClaimedDeploymentFailureResult(
  error: Error | undefined,
  imageRef: string | undefined,
): AttemptedClaimedDeploymentResult {
  return {
    ...(imageRef !== undefined ? { imageRef } : {}),
    failureError: error ?? new Error('Unknown deployment failure.'),
  };
}

async function reportWorkerIterationFailure(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  failureError: Error | undefined,
  imageRef: string | undefined,
): Promise<boolean> {
  if (shouldReportWorkerFailure(failureError)) {
    const failureMessage: string = readWorkerFailureMessage(failureError, 'Unknown deployment failure.');
    await appendRuntimeStepEventSafely(
      buildDeploymentEventContext(request, deployment),
      'completed',
      'failed',
      failureMessage,
      undefined,
      'error',
    );
    await failDeployment(request, {
      deploymentId: deployment.deploymentId,
      ...(imageRef !== undefined ? { imageRef } : {}),
      message: failureMessage,
    });
  }

  return true;
}

function shouldReportWorkerFailure(error: Error | undefined): boolean {
  return !isExpectedCompletionFollowUpError(error);
}

function isExpectedCompletionFollowUpError(error: Error | undefined): boolean {
  return (
    error !== undefined &&
    isCompartmentRequestError(error) &&
    (error.code === 'edge_state_update_failed' || error.code === 'project_archived')
  );
}

async function buildClaimedDeploymentImage(
  request: CompartmentRequester,
  releaseArchiveRequest: CompartmentBinaryRequester,
  deployment: WorkerClaimedDeployment,
  dockerNamespace: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
): Promise<string> {
  return await buildReleaseImageFromSource(
    request,
    releaseArchiveRequest,
    deployment,
    dockerNamespace,
    artifactRegistry,
  );
}
