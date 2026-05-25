import {
  acquireDeploymentMovementTargetLocks,
  listTargetDeploymentsByTarget,
} from '../queries/deployment-movement.query';
import type { DeploymentMovementTargetSelector } from '../queries/deployment-movement.query.types';
import { createQueuedExistingArtifactDeploymentBatchWithExecutor } from '../queries/deployments.query';
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
  withDeploymentRunCleanupOnError,
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

export async function queueSerializedArtifactDeploymentMovement(
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
  operationType: DeploymentMovementOperationType,
): Promise<DeploymentJoinedRow[]> {
  const deploymentRunId: string = await createMovementDeploymentRunId(
    sourceDeployments[0],
    targetEnvironment,
    operationType,
  );
  const queuedDeployments: DeploymentRow[] = await queueSerializedMovementDeployments(
    sourceDeployments,
    targetEnvironment,
    actorPrincipalId,
    deploymentRunId,
    operationType,
  );

  return await finalizeQueuedMovementDeployments(queuedDeployments, deploymentRunId);
}

async function queueSerializedMovementDeployments(
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
  deploymentRunId: string,
  operationType: DeploymentMovementOperationType,
): Promise<DeploymentRow[]> {
  return await withDeploymentRunCleanupOnError(
    deploymentRunId,
    async (): Promise<DeploymentRow[]> =>
      await resolveSerializedDeploymentMovementBatch(
        buildSerializedDeploymentMovementBatchItems(
          sourceDeployments,
          targetEnvironment,
          actorPrincipalId,
          deploymentRunId,
          operationType,
        ),
      ),
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
): Promise<DeploymentRow[]> {
  if (items.length === 0) {
    return [];
  }
  const sortedItems: SerializedDeploymentMovementBatchItem[] = [...items].sort(
    compareSerializedDeploymentMovementTargetLockOrder,
  );

  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<DeploymentRow[]> =>
      await resolveSerializedDeploymentMovementBatchInTransaction(tx, sortedItems),
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
): Promise<DeploymentRow[]> {
  const targets: DeploymentMovementTargetSelector[] = collectSerializedDeploymentMovementTargets(items);

  await acquireDeploymentMovementTargetLocks(tx, targets);

  const duplicateDeployments: DeploymentRow[] | null = readDuplicateSerializedDeploymentMovementBatch(
    items,
    await listTargetDeploymentsByTarget(tx, targets),
  );
  if (duplicateDeployments !== null) {
    return duplicateDeployments;
  }

  return await createQueuedSerializedDeploymentMovementBatch(tx, items);
}

async function createQueuedSerializedDeploymentMovementBatch(
  tx: DeploymentTransaction,
  items: SerializedDeploymentMovementBatchItem[],
): Promise<DeploymentRow[]> {
  const queuedDeployments: DeploymentRow[] = await createQueuedExistingArtifactDeploymentBatchWithExecutor(
    tx,
    toQueuedExistingArtifactDeploymentBatchItems(items),
  );

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
