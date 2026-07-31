import {
  acquireDeploymentMovementTargetLocks,
  listTargetDeploymentsByTarget,
} from '../queries/deployment-movement.query';
import type { DeploymentMovementTargetSelector } from '../queries/deployment-movement.query.types';
import { createQueuedExistingArtifactDeploymentBatchWithExecutor } from '../queries/deployments.query';
import type { QueuedExistingArtifactDeploymentBatchResult } from '../queries/deployment-batch.query.types';
import { lockActiveProjectDeploymentMutationWithExecutor } from '../queries/deployment-project-mutation.query';
import type {
  DeploymentProjectMutationRejection,
  DeploymentProjectMutationStatus,
} from '../queries/deployment-project-mutation.query.types';
import type {
  CreateQueuedExistingArtifactDeploymentBatchItem,
  DeploymentJoinedRow,
  DeploymentTransaction,
  DeploymentRow,
  EnvironmentRow,
} from '../queries/deployments.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { buildArtifactDeploymentBatchItem } from './artifact-deployment-batch-item.service';
import {
  appendQueuedDeploymentRunEvents,
  createDeploymentRunId,
  withDeploymentRunCleanupOnErrorOrResult,
} from './deployment-run-creation.service';
import { readDeploymentRunSourceProvenanceInput } from './deployment-run-source.service';
import { deleteDeploymentRunById } from '../queries/deployment-runs.query';
import {
  collectSerializedDeploymentMovementTargets,
  compareSerializedDeploymentMovementTargetLockOrder,
  readDuplicateSerializedDeploymentMovementBatch,
  sortResolvedDeploymentMovementItemsByRequestIndex,
} from './artifact-deployment-movement-batch.service';
import type {
  ResolvedDeploymentMovementBatchItem,
  SerializedDeploymentMovementBatchItem,
} from './artifact-deployment-movement.service.types';
import { hydrateJoinedDeploymentsById } from './joined-deployment-hydration.service';
import type { DeploymentMovementOperationType } from './deployment-movement.service.types';
import { isDeploymentProjectMutationRejection } from './deployment-project-mutation-result.service';

export async function queueSerializedArtifactDeploymentMovement(
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
  operationType: DeploymentMovementOperationType,
): Promise<DeploymentJoinedRow[] | DeploymentProjectMutationRejection> {
  const deploymentRunId: string = await createMovementDeploymentRunId(
    sourceDeployments[0],
    targetEnvironment,
    operationType,
  );
  const queuedDeployments: DeploymentRow[] | DeploymentProjectMutationRejection =
    await queueSerializedMovementDeployments(
      sourceDeployments,
      targetEnvironment,
      actorPrincipalId,
      deploymentRunId,
      operationType,
    );
  if (isDeploymentProjectMutationRejection(queuedDeployments)) {
    return queuedDeployments;
  }

  return await finalizeQueuedMovementDeployments(queuedDeployments, deploymentRunId);
}

async function queueSerializedMovementDeployments(
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
  deploymentRunId: string,
  operationType: DeploymentMovementOperationType,
): Promise<DeploymentRow[] | DeploymentProjectMutationRejection> {
  return await withDeploymentRunCleanupOnErrorOrResult(
    deploymentRunId,
    async (): Promise<DeploymentRow[] | DeploymentProjectMutationRejection> =>
      await resolveSerializedDeploymentMovementBatch(
        buildSerializedDeploymentMovementBatchItems(
          sourceDeployments,
          targetEnvironment,
          actorPrincipalId,
          deploymentRunId,
          operationType,
        ),
        targetEnvironment.projectId,
      ),
    isDeploymentProjectMutationRejection,
  );
}

async function createMovementDeploymentRunId(
  sourceDeployment: DeploymentJoinedRow | undefined,
  targetEnvironment: EnvironmentRow,
  operationType: DeploymentMovementOperationType,
): Promise<string> {
  return await createDeploymentRunId({
    environmentId: targetEnvironment.id,
    label: sourceDeployment?.deployment.label ?? null,
    sourceProvenance:
      sourceDeployment !== undefined ? readDeploymentRunSourceProvenanceInput(sourceDeployment) : undefined,
    triggerType: resolveMovementDeploymentRunTriggerType(operationType),
    updatedAt: new Date(),
  });
}

async function resolveSerializedDeploymentMovementBatch(
  items: SerializedDeploymentMovementBatchItem[],
  projectId: string,
): Promise<DeploymentRow[] | DeploymentProjectMutationRejection> {
  if (items.length === 0) {
    return [];
  }
  const sortedItems: SerializedDeploymentMovementBatchItem[] = [...items].sort(
    compareSerializedDeploymentMovementTargetLockOrder,
  );

  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<DeploymentRow[] | DeploymentProjectMutationRejection> =>
      await resolveSerializedDeploymentMovementBatchInTransaction(tx, sortedItems, projectId),
  );
}

function buildSerializedDeploymentMovementBatchItems(
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
  deploymentRunId: string,
  operationType: DeploymentMovementOperationType,
): SerializedDeploymentMovementBatchItem[] {
  return sourceDeployments.map(
    (sourceDeployment: DeploymentJoinedRow, requestIndex: number): SerializedDeploymentMovementBatchItem => ({
      item: buildArtifactDeploymentBatchItem(
        sourceDeployment,
        targetEnvironment,
        actorPrincipalId,
        deploymentRunId,
        operationType,
      ),
      operationType,
      requestIndex,
      sourceDeploymentId: sourceDeployment.deployment.id,
    }),
  );
}

function resolveMovementDeploymentRunTriggerType(
  operationType: DeploymentMovementOperationType,
): 'promote' | 'rollback' {
  return operationType === 'deployment.promote' ? 'promote' : 'rollback';
}

async function finalizeQueuedMovementDeployments(
  queuedDeployments: DeploymentRow[],
  deploymentRunId: string,
): Promise<DeploymentJoinedRow[]> {
  if (!allDeploymentsBelongToRun(queuedDeployments, deploymentRunId)) {
    await deleteDeploymentRunById(deploymentRunId);
    return await hydrateJoinedDeploymentsById(queuedDeployments);
  }

  await appendQueuedDeploymentRunEvents(queuedDeployments);
  return await hydrateJoinedDeploymentsById(queuedDeployments);
}

function allDeploymentsBelongToRun(deployments: DeploymentRow[], deploymentRunId: string): boolean {
  return deployments.every((deployment: DeploymentRow): boolean => deployment.deploymentRunId === deploymentRunId);
}

async function resolveSerializedDeploymentMovementBatchInTransaction(
  tx: DeploymentTransaction,
  items: SerializedDeploymentMovementBatchItem[],
  projectId: string,
): Promise<DeploymentRow[] | DeploymentProjectMutationRejection> {
  const projectStatus: DeploymentProjectMutationStatus = await lockActiveProjectDeploymentMutationWithExecutor(
    tx,
    projectId,
  );
  if (projectStatus !== 'active') {
    return projectStatus;
  }

  const targets: DeploymentMovementTargetSelector[] = collectSerializedDeploymentMovementTargets(items);

  await acquireDeploymentMovementTargetLocks(tx, targets);

  const duplicateDeployments: DeploymentRow[] | null = readDuplicateSerializedDeploymentMovementBatch(
    items,
    await listTargetDeploymentsByTarget(tx, targets),
  );
  if (duplicateDeployments !== null) {
    return duplicateDeployments;
  }

  return await createQueuedSerializedDeploymentMovementBatch(tx, items, projectId);
}

async function createQueuedSerializedDeploymentMovementBatch(
  tx: DeploymentTransaction,
  items: SerializedDeploymentMovementBatchItem[],
  projectId: string,
): Promise<DeploymentRow[] | DeploymentProjectMutationRejection> {
  const queuedDeployments: QueuedExistingArtifactDeploymentBatchResult =
    await createQueuedExistingArtifactDeploymentBatchWithExecutor(tx, {
      items: toQueuedExistingArtifactDeploymentBatchItems(items),
      projectId,
    });
  if (isDeploymentProjectMutationRejection(queuedDeployments)) {
    return queuedDeployments;
  }

  return sortResolvedDeploymentMovementItemsByRequestIndex(
    queuedDeployments.map(
      (deployment: DeploymentRow, index: number): ResolvedDeploymentMovementBatchItem => ({
        deployment,
        requestIndex: items[index]!.requestIndex,
      }),
    ),
  );
}

function toQueuedExistingArtifactDeploymentBatchItems(
  items: SerializedDeploymentMovementBatchItem[],
): CreateQueuedExistingArtifactDeploymentBatchItem[] {
  return items.map(
    (item: SerializedDeploymentMovementBatchItem): CreateQueuedExistingArtifactDeploymentBatchItem => item.item,
  );
}
