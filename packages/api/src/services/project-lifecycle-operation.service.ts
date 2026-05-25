import type { EnvironmentRow } from '../queries/deployments.query.types';
import { insertOperationRecord, updateOperationRecord } from '../queries/operations.query';
import type { OperationRecord } from '../queries/operations.query.types';

export async function createProjectStopOperation(
  actorPrincipalId: string,
  projectName: string,
  environment: EnvironmentRow,
): Promise<string> {
  const operation: OperationRecord = await insertOperationRecord({
    actorPrincipalId,
    status: 'running',
    summary: `Stopping project ${projectName}/${environment.name}`,
    targetId: environment.id,
    targetType: 'environment',
    type: 'deployment.stop',
  });

  return operation.id;
}

export async function recordProjectStopOperationSuccess(
  operationId: string,
  projectName: string,
  environment: EnvironmentRow,
  completedAt: Date,
): Promise<void> {
  await updateOperationRecord({
    completedAt,
    operationId,
    status: 'succeeded',
    summary: `Stopped project ${projectName}/${environment.name}`,
  });
}

export async function recordProjectStopOperationFailure(
  operationId: string,
  projectName: string,
  environment: EnvironmentRow,
  completedAt: Date,
): Promise<void> {
  await updateOperationRecord({
    completedAt,
    operationId,
    status: 'failed',
    summary: `Failed to stop project ${projectName}/${environment.name}`,
  });
}
