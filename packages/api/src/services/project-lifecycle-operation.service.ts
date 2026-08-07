import type { EnvironmentRow } from '../queries/deployments.query.types';
import { insertOperationRecord, updateOperationRecord } from '../queries/operations.query';
import type { OperationRecord } from '../queries/operations.query.types';
import type { ProjectRow } from '../queries/projects.query.types';

export async function createProjectStopOperation(
  actorPrincipalId: string,
  project: ProjectRow,
  environment: EnvironmentRow,
): Promise<string> {
  const operation: OperationRecord = await insertOperationRecord({
    actorPrincipalId,
    organizationId: project.organizationId,
    status: 'running',
    summary: `Stopping project ${project.name}/${environment.name}`,
    targetId: environment.id,
    targetType: 'environment',
    type: 'deployment.stop',
  });

  return operation.id;
}

export async function recordProjectStopOperationSuccess(
  operationId: string,
  project: ProjectRow,
  environment: EnvironmentRow,
  completedAt: Date,
): Promise<void> {
  await updateOperationRecord({
    completedAt,
    operationId,
    organizationId: project.organizationId,
    status: 'succeeded',
    summary: `Stopped project ${project.name}/${environment.name}`,
  });
}

export async function recordProjectStopOperationFailure(
  operationId: string,
  project: ProjectRow,
  environment: EnvironmentRow,
  completedAt: Date,
): Promise<void> {
  await updateOperationRecord({
    completedAt,
    operationId,
    organizationId: project.organizationId,
    status: 'failed',
    summary: `Failed to stop project ${project.name}/${environment.name}`,
  });
}
