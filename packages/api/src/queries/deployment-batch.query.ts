import { and, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { buildArtifacts, sourceUploads } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { createDeploymentWithExecutor, requirePersistedRow, toBuildArtifactRow } from './deployments.query';
import type { QueuedDeploymentBatchResult } from './deployment-batch.query.types';
import { lockActiveProjectDeploymentMutationWithExecutor } from './deployment-project-mutation.query';
import type { DeploymentProjectMutationStatus } from './deployment-project-mutation.query.types';
import type {
  BuildArtifactRow,
  ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
  CreateBuildArtifactInput,
  CreateQueuedDeploymentBatchItem,
  DeploymentRow,
  DeploymentTransaction,
} from './deployments.query.types';
import { insertOperationRecordWithExecutor } from './operations.query';
import type { OperationRecord } from './operations.query.types';

interface ConsumedSourceUploadRow {
  id: string;
}

export async function consumeSourceUploadAndCreateQueuedDeploymentBatch(
  input: ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
): Promise<QueuedDeploymentBatchResult> {
  return await getApiDatabase().transaction(async (tx: DeploymentTransaction): Promise<QueuedDeploymentBatchResult> => {
    const projectStatus: DeploymentProjectMutationStatus = await lockActiveProjectDeploymentMutationWithExecutor(
      tx,
      input.projectId,
    );
    if (projectStatus !== 'active') {
      return projectStatus;
    }
    if (!(await consumeSourceUploadWithExecutor(tx, input))) {
      return undefined;
    }

    return await createQueuedDeploymentBatchWithExecutor(tx, input.items);
  });
}

async function consumeSourceUploadWithExecutor(
  tx: DeploymentTransaction,
  input: ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
): Promise<boolean> {
  const rows: ConsumedSourceUploadRow[] = await tx
    .update(sourceUploads)
    .set({ consumedAt: input.consumedAt })
    .where(
      and(
        eq(sourceUploads.id, input.sourceUploadId),
        eq(sourceUploads.organizationId, input.organizationId),
        eq(sourceUploads.createdByPrincipalId, input.actorPrincipalId),
        or(isNull(sourceUploads.projectId), eq(sourceUploads.projectId, input.projectId)),
        or(isNull(sourceUploads.environmentId), eq(sourceUploads.environmentId, input.environmentId)),
        buildSourceUploadServiceScopeCondition(input.projectServiceIds),
        isNull(sourceUploads.consumedAt),
        gt(sourceUploads.expiresAt, input.expiresAtCutoff),
      ),
    )
    .returning({ id: sourceUploads.id });

  return rows[0] !== undefined;
}

function buildSourceUploadServiceScopeCondition(projectServiceIds: string[]): SQL {
  const condition: SQL | undefined = or(
    isNull(sourceUploads.projectServiceId),
    inArray(sourceUploads.projectServiceId, projectServiceIds),
  );
  if (condition === undefined) {
    throw new Error('Expected source upload service scope condition.');
  }

  return condition;
}

async function createQueuedDeploymentBatchWithExecutor(
  tx: DeploymentTransaction,
  items: CreateQueuedDeploymentBatchItem[],
): Promise<DeploymentRow[]> {
  const queuedDeployments: DeploymentRow[] = [];

  for (const item of items) {
    const artifact: BuildArtifactRow = await createBuildArtifactWithExecutor(tx, item.artifact);
    const operation: OperationRecord = await insertOperationRecordWithExecutor(tx, item.operation);
    const deployment: DeploymentRow = await createDeploymentWithExecutor(tx, {
      ...item.deployment,
      buildArtifactId: artifact.id,
      operationId: operation.id,
    });
    queuedDeployments.push(deployment);
  }

  return queuedDeployments;
}

async function createBuildArtifactWithExecutor(
  executor: Pick<Database, 'insert'>,
  input: CreateBuildArtifactInput,
): Promise<BuildArtifactRow> {
  const [artifact] = await executor.insert(buildArtifacts).values(input).returning();
  return toBuildArtifactRow(requirePersistedRow(artifact, 'build artifact'));
}
