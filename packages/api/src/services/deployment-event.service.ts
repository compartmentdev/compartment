import type { WorkerAppendDeploymentEventRequest } from '@compartment/contracts';
import { createDeploymentNotFoundError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { appendDeploymentRunEvent } from '../queries/deployment-run-events.query';
import { findDeploymentRunDeployment } from '../queries/deployments.query';
import type { DeploymentRow } from '../queries/deployments.query.types';

export async function appendDeploymentEventForWorker(input: WorkerAppendDeploymentEventRequest): Promise<void> {
  const deployment: DeploymentRow | undefined = await findDeploymentRunDeployment({
    deploymentId: input.deploymentId,
    deploymentRunId: input.deploymentRunId,
  });
  if (deployment === undefined) {
    throw createDeploymentNotFoundError();
  }
  await appendDeploymentRunEvent({
    createdAt: input.timestamp === undefined ? new Date() : new Date(input.timestamp),
    deploymentId: input.deploymentId,
    deploymentRunId: input.deploymentRunId,
    id: createId('drev'),
    level: input.level,
    message: input.message,
    status: input.status ?? null,
    stepKey: input.stepKey,
    stream: input.stream,
  });
}
