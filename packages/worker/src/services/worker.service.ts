import type { WorkerClaimDeploymentResponse, WorkerClaimedDeployment } from '@compartment/contracts';
import {
  claimNextDeployment,
  createCompartmentBinaryRequester,
  createCompartmentRawRequester,
  createCompartmentRequester,
  failDeployment,
  isCompartmentRequestError,
  type CompartmentBinaryRequester,
  type CompartmentRawRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import type { Logger } from 'pino';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import { buildReleaseImageFromSource } from './worker-build.service';
import { appendDeploymentStepEventSafely, buildDeploymentEventContext } from './worker-deployment-event.service';
import { readWorkerFailureMessage } from './worker-failure-message.service';
import { runGitSourceResolutionIteration } from './worker-git-source-resolution.service';
import { runGitSourceSyncIteration } from './worker-git-source-sync.service';
import type {
  AttemptClaimedDeploymentCompletionInput,
  AttemptedClaimedDeploymentResult,
  WorkerRequesterInput,
} from './worker-iteration.types';
import { handoffBuiltDeploymentToKube } from './worker-kube-deployment-handoff.service';
import { runScheduledResourceOperationIteration } from './worker-resource-operation-scheduler.service';

export async function runWorkerIteration(
  apiUrl: string,
  internalToken: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
  logger: Logger<never, boolean>,
): Promise<boolean> {
  const requesterInput: WorkerRequesterInput = { apiUrl, internalToken };
  const request: CompartmentRequester = createCompartmentRequester(requesterInput);
  const releaseArchiveRequest: CompartmentBinaryRequester = createCompartmentBinaryRequester(requesterInput);
  const rawRequest: CompartmentRawRequester = createCompartmentRawRequester(requesterInput);

  return (
    (await runGitSourceResolutionIteration(request, rawRequest)) ||
    (await runScheduledResourceOperationIteration(request, logger)) ||
    (await handleClaimedDeploymentOrContinue(request, releaseArchiveRequest, artifactRegistry)) ||
    (await runGitSourceSyncIteration(request))
  );
}

async function handleClaimedDeploymentOrContinue(
  request: CompartmentRequester,
  releaseArchiveRequest: CompartmentBinaryRequester,
  artifactRegistry: WorkerArtifactRegistryConfig,
): Promise<boolean> {
  const claimed: WorkerClaimDeploymentResponse = await claimNextDeployment(request);
  if (claimed.deployment === null) {
    return false;
  }

  return await completeAndPersistClaimedDeployment({
    artifactRegistry,
    deployment: claimed.deployment,
    releaseArchiveRequest,
    request,
  });
}

async function completeAndPersistClaimedDeployment(input: AttemptClaimedDeploymentCompletionInput): Promise<boolean> {
  const result: AttemptedClaimedDeploymentResult = await attemptClaimedDeploymentCompletion(input);
  if (result.failureError === undefined) {
    return true;
  }

  return await reportWorkerIterationFailure(input.request, input.deployment, result.failureError, result.imageRef);
}

async function attemptClaimedDeploymentCompletion(
  input: AttemptClaimedDeploymentCompletionInput,
): Promise<AttemptedClaimedDeploymentResult> {
  let imageRef: string | undefined;
  try {
    imageRef = await buildReleaseImageFromSource(
      input.request,
      input.releaseArchiveRequest,
      input.deployment,
      input.artifactRegistry,
    );
    await handoffBuiltDeploymentToKube(input.request, input.deployment, imageRef);
    return { imageRef };
  } catch (error) {
    return {
      ...(imageRef !== undefined ? { imageRef } : {}),
      failureError: error instanceof Error ? error : new Error('Unknown deployment failure.'),
    };
  }
}

async function reportWorkerIterationFailure(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  failureError: Error,
  imageRef: string | undefined,
): Promise<boolean> {
  if (!isExpectedCompletionFollowUpError(failureError)) {
    const failureMessage: string = readWorkerFailureMessage(failureError, 'Unknown deployment failure.');
    await appendDeploymentStepEventSafely(
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

function isExpectedCompletionFollowUpError(error: Error): boolean {
  return (
    isCompartmentRequestError(error) && (error.code === 'edge_state_update_failed' || error.code === 'project_archived')
  );
}
