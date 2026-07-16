import type { DeploymentRunStepKey } from '@compartment/contracts';
import { appendDeploymentStepEventSafely } from './worker-deployment-event.service';
import { readWorkerFailureMessage } from './worker-failure-message.service';
import type { WorkerDeploymentEventContext } from './worker-deployment-event.types';

type FailureStepKeyResolver = (error: Error | undefined) => DeploymentRunStepKey;

interface TrackedDeploymentStepInput<Result> {
  eventContext: WorkerDeploymentEventContext;
  failureStepKey?: DeploymentRunStepKey | FailureStepKeyResolver | undefined;
  failureSummary: string;
  run: () => Promise<Result>;
  startMessage: string;
  stepKey: DeploymentRunStepKey;
  successMessage?: string | undefined;
}

export async function runTrackedDeploymentStep<Result>(input: TrackedDeploymentStepInput<Result>): Promise<Result> {
  await appendTrackedStepStarted(input);

  try {
    const result: Result = await input.run();
    await appendTrackedStepSucceeded(input);
    return result;
  } catch (error) {
    await appendTrackedStepFailed(input, error instanceof Error ? error : undefined);
    throw error;
  }
}

async function appendTrackedStepStarted<Result>(input: TrackedDeploymentStepInput<Result>): Promise<void> {
  await appendDeploymentStepEventSafely(input.eventContext, input.stepKey, 'running', input.startMessage);
}

async function appendTrackedStepSucceeded<Result>(input: TrackedDeploymentStepInput<Result>): Promise<void> {
  if (input.successMessage === undefined) {
    return;
  }

  await appendDeploymentStepEventSafely(input.eventContext, input.stepKey, 'succeeded', input.successMessage);
}

async function appendTrackedStepFailed<Result>(
  input: TrackedDeploymentStepInput<Result>,
  error: Error | undefined,
): Promise<void> {
  await appendDeploymentStepEventSafely(
    input.eventContext,
    resolveFailureStepKey(input.failureStepKey, input.stepKey, error),
    'failed',
    buildTrackedFailureMessage(input.failureSummary, error),
    undefined,
    'error',
  );
}

function buildTrackedFailureMessage(summary: string, error: Error | undefined): string {
  return `${summary}: ${readWorkerFailureMessage(error, 'unexpected error')}`;
}

function resolveFailureStepKey(
  failureStepKey: DeploymentRunStepKey | FailureStepKeyResolver | undefined,
  defaultStepKey: DeploymentRunStepKey,
  error: Error | undefined,
): DeploymentRunStepKey {
  if (typeof failureStepKey === 'function') {
    return failureStepKey(error);
  }

  return failureStepKey ?? defaultStepKey;
}
