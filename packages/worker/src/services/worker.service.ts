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
  WorkerBuildResult,
  WorkerBuildTask,
  WorkerRequesterInput,
} from './worker-iteration.types';
import { handoffBuiltDeploymentToKube } from './worker-kube-deployment-handoff.service';
import { runScheduledResourceOperationIteration } from './worker-resource-operation-scheduler.service';

export async function runAuxiliaryWorkerIteration(
  config: WorkerConfig,
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
    (await runGitSourceSyncIteration(request))
  );
}

export async function startNextBuild(
  config: WorkerConfig,
  runtime: KubeRuntime,
  logger: Logger<never, boolean>,
): Promise<WorkerBuildTask | null> {
  const request: CompartmentRequester = createCompartmentRequester({
    apiUrl: config.apiUrl,
    internalToken: config.runtimeControlToken,
  });
  const claimed: WorkerClaimDeploymentResponse = await claimNextDeployment(request, config.buildQueue);
  logBuildQueueObservation(logger, claimed);
  if (claimed.deployment === null) {
    return null;
  }

  return {
    completion: completeAndPersistClaimedDeployment({
      config,
      deployment: claimed.deployment,
      request,
      runtime,
    }),
  };
}

function logBuildQueueObservation(logger: Logger<never, boolean>, claimed: WorkerClaimDeploymentResponse): void {
  logger.info(
    {
      activeBuildCount: claimed.queue.activeBuildCount,
      kind: 'build-queue',
      queueDepth: claimed.queue.queueDepth,
      waitTimeMs: claimed.queue.waitTimeMs,
    },
    'Build queue observed.',
  );
}

async function completeAndPersistClaimedDeployment(
  input: AttemptClaimedDeploymentCompletionInput,
): Promise<WorkerBuildResult> {
  const result: AttemptedClaimedDeploymentResult = await attemptClaimedDeploymentCompletion(input);
  if (result.failureError === undefined) {
    return 'succeeded';
  }

  await reportWorkerIterationFailure(input.request, input.deployment, result.failureError, result.imageRef);
  return 'failed';
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
): Promise<void> {
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
}

function isExpectedCompletionFollowUpError(error: Error): boolean {
  return (
    isCompartmentRequestError(error) && (error.code === 'edge_state_update_failed' || error.code === 'project_archived')
  );
}
