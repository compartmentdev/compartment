import { and, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { buildArtifacts, sourceUploads } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { createDeploymentWithExecutor, toBuildArtifactRow } from './deployments.query';
import type {
  BuildArtifactRow,
  ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
  ConsumeSourceUploadAndCreateQueuedDeploymentBatchResult,
  CreateBuildArtifactInput,
  CreateQueuedDeploymentBatchItem,
  DeploymentRow,
  DeploymentTransaction,
} from './deployments.query.types';
import { insertOperationRecordWithExecutor } from './operations.query';
import type { OperationRecord } from './operations.query.types';

interface CreatedBuildArtifact {
  readonly artifact: BuildArtifactRow;
  readonly created: boolean;
}

interface CreatedQueuedDeploymentBatch {
  readonly deployments: DeploymentRow[];
  readonly retainedSubmittedUpload: boolean;
}

const buildArtifactAcquisitionAttemptCount: number = 3;

export async function consumeSourceUploadAndCreateQueuedDeploymentBatch(
  input: ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
): Promise<ConsumeSourceUploadAndCreateQueuedDeploymentBatchResult | undefined> {
  return await getApiDatabase().transaction(
    async (tx: DeploymentTransaction): Promise<ConsumeSourceUploadAndCreateQueuedDeploymentBatchResult | undefined> => {
      if (!(await consumeSourceUploadWithExecutor(tx, input))) {
        return undefined;
      }

      const result: CreatedQueuedDeploymentBatch = await createQueuedDeploymentBatchWithExecutor(tx, input.items);
      if (!result.retainedSubmittedUpload) {
        await tx.delete(sourceUploads).where(eq(sourceUploads.id, input.sourceUploadId));
      }
      return {
        deployments: result.deployments,
        redundantSourceUploadId: result.retainedSubmittedUpload ? null : input.sourceUploadId,
      };
    },
  );
}

async function consumeSourceUploadWithExecutor(
  tx: DeploymentTransaction,
  input: ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
): Promise<boolean> {
  const rows: { id: string }[] = await tx
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
): Promise<CreatedQueuedDeploymentBatch> {
  const queuedDeployments: DeploymentRow[] = [];
  let retainedSubmittedUpload: boolean = false;

  for (const item of items) {
    const createdArtifact: CreatedBuildArtifact = await createBuildArtifactWithExecutor(tx, item.artifact);
    const artifact: BuildArtifactRow = createdArtifact.artifact;
    retainedSubmittedUpload ||= createdArtifact.created;
    const operation: OperationRecord = await insertOperationRecordWithExecutor(tx, item.operation);
    const deployment: DeploymentRow = await createDeploymentWithExecutor(tx, {
      ...item.deployment,
      buildArtifactId: artifact.id,
      operationId: operation.id,
    });
    queuedDeployments.push(deployment);
  }

  return { deployments: queuedDeployments, retainedSubmittedUpload };
}

async function createBuildArtifactWithExecutor(
  executor: Pick<Database, 'insert' | 'select'>,
  input: CreateBuildArtifactInput,
): Promise<CreatedBuildArtifact> {
  for (let attempt: number = 0; attempt < buildArtifactAcquisitionAttemptCount; attempt += 1) {
    const [artifact] = await executor
      .insert(buildArtifacts)
      .values(input)
      .onConflictDoNothing({ target: buildArtifacts.fingerprint })
      .returning();
    if (artifact !== undefined) {
      return { artifact: toBuildArtifactRow(artifact), created: true };
    }
    const existing: BuildArtifactRow | undefined = await findAvailableBuildArtifactWithExecutor(
      executor,
      input.fingerprint,
    );
    if (existing !== undefined) {
      return { artifact: existing, created: false };
    }
  }
  throw new Error('Build artifact fingerprint contention did not settle.');
}

async function findAvailableBuildArtifactWithExecutor(
  executor: Pick<Database, 'select'>,
  fingerprint: string,
): Promise<BuildArtifactRow | undefined> {
  const [artifact] = await executor
    .select()
    .from(buildArtifacts)
    .where(and(eq(buildArtifacts.fingerprint, fingerprint), eq(buildArtifacts.imageRetentionState, 'available')))
    .limit(1);
  return artifact === undefined ? undefined : toBuildArtifactRow(artifact);
}
