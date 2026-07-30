import type { WorkerClaimDeploymentResponse, WorkerClaimedDeployment } from '@compartment/contracts';
import {
  claimNextDeployment,
  createCompartmentRawRequester,
  createCompartmentRequester,
  failDeployment,
  isCompartmentRequestError,
  type CompartmentRawRequester,
  type CompartmentRequester,
} from '@compartment/sdk';
import type { Logger } from 'pino';
import type { KubeRuntime } from '@compartment/kube-runtime';
import type { WorkerConfig } from '../config';
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
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: Logger<never, boolean>,
): Promise<boolean> {
  const requesterInput: WorkerRequesterInput = {
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
  };
  const request: CompartmentRequester = createCompartmentRequester(requesterInput);
  const rawRequest: CompartmentRawRequester = createCompartmentRawRequester(requesterInput);

  return (
    (await runGitSourceResolutionIteration(request, rawRequest)) ||
    (await runScheduledResourceOperationIteration(request, logger)) ||
    (await handleClaimedDeploymentOrContinue(request, config, runtime)) ||
    (await runGitSourceSyncIteration(request))
  );
}

async function handleClaimedDeploymentOrContinue(
  request: CompartmentRequester,
  config: WorkerConfig,
  runtime: KubeRuntime,
): Promise<boolean> {
  const claimed: WorkerClaimDeploymentResponse = await claimNextDeployment(request);
  if (claimed.deployment === null) {
    return false;
  }

  return await completeAndPersistClaimedDeployment({
    config,
    deployment: claimed.deployment,
    request,
    runtime,
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
    imageRef = await buildReleaseImageFromSource(input.request, input.deployment, input.config, input.runtime);
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
