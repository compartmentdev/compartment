import type {
  DeploymentLogStream,
  DeploymentRunLogLevel,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
  WorkerAppendDeploymentEventRequest,
  WorkerClaimedDeployment,
} from '@compartment/contracts';
import { appendDeploymentEvent, type CompartmentRequester } from '@compartment/sdk';
import type { AppendDeploymentEventInput, WorkerDeploymentEventContext } from './worker-deployment-event.types';

export function buildDeploymentEventContext(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
): WorkerDeploymentEventContext {
  return {
    deploymentId: deployment.deploymentId,
    deploymentRunId: deployment.deploymentRunId,
    request,
  };
}

export async function appendDeploymentLogLineSafely(
  context: WorkerDeploymentEventContext,
  stepKey: DeploymentRunStepKey,
  stream: DeploymentLogStream,
  message: string,
  level: DeploymentRunLogLevel = 'info',
): Promise<void> {
  await appendDeploymentEventSafely(context, {
    level,
    message,
    stepKey,
    stream,
  });
}

export async function appendDeploymentStepEventSafely(
  context: WorkerDeploymentEventContext,
  stepKey: DeploymentRunStepKey,
  status: DeploymentRunStepStatus,
  message: string,
  timestamp: string | undefined = undefined,
  level: DeploymentRunLogLevel = 'info',
): Promise<void> {
  await appendDeploymentEventSafely(context, {
    level,
    message,
    status,
    stepKey,
    timestamp,
  });
}

async function appendDeploymentEventSafely(
  context: WorkerDeploymentEventContext,
  input: AppendDeploymentEventInput,
): Promise<void> {
  const event: WorkerAppendDeploymentEventRequest = {
    deploymentId: context.deploymentId,
    deploymentRunId: context.deploymentRunId,
    level: input.level ?? 'info',
    message: input.message,
    ...(input.status !== undefined ? { status: input.status } : {}),
    stepKey: input.stepKey,
    stream: input.stream ?? 'compartment',
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
  };

  await appendDeploymentEvent(context.request, event).catch((): void => undefined);
}
