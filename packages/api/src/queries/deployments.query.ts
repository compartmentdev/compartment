import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { buildArtifacts, deployments, environments } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { toDeploymentRow } from './deployment-row.mapper';
import type { OperationRecord } from './operations.query.types';
import { requirePersistedRow } from './persisted-row.query.shared';
import { insertOperationRecordWithExecutor } from './operations.query';
import type {
  BuildArtifactImageRetentionState,
  BuildArtifactRow,
  CreateDeploymentInput,
  CreateQueuedExistingArtifactDeploymentBatchItem,
  DeploymentRow,
  DeploymentTransaction,
  FindDeploymentRunDeploymentInput,
  MarkBuildArtifactsCleanedInput,
  MarkDeploymentFailedInput,
  PersistedDeploymentRow,
  PersistedBuildArtifactRow,
} from './deployments.query.types';

export async function failOwnedBuildArtifact(
  buildArtifactId: string,
  deploymentId: string,
  imageRef?: string,
): Promise<boolean> {
  const [artifact] = await getApiDatabase()
    .update(buildArtifacts)
    .set({
      buildOwnerDeploymentId: null,
      buildState: 'failed',
      fingerprint: retainedFailedArtifactFingerprint(deploymentId),
      ...(imageRef === undefined ? {} : { imageRef }),
      sbomDigest: null,
      sbomImageDigest: null,
      sbomJson: null,
      updatedAt: new Date(),
    })
    .where(and(eq(buildArtifacts.id, buildArtifactId), eq(buildArtifacts.buildOwnerDeploymentId, deploymentId)))
    .returning({ fingerprint: buildArtifacts.fingerprint });
  return artifact?.fingerprint === null;
}

function retainedFailedArtifactFingerprint(deploymentId: string): SQL<string | null> {
  return sql<string | null>`case when exists (
    select 1 from ${deployments}
    where ${deployments.buildArtifactId} = ${buildArtifacts.id}
      and ${deployments.id} <> ${deploymentId}
      and ${deployments.status} = ${'queued'}
  ) then ${buildArtifacts.fingerprint} else null end`;
}
export async function findBuildArtifactById(artifactId: string): Promise<BuildArtifactRow | undefined> {
  const [artifact] = await getApiDatabase()
    .select()
    .from(buildArtifacts)
    .where(eq(buildArtifacts.id, artifactId))
    .limit(1);
  return artifact === undefined ? undefined : toBuildArtifactRow(artifact);
}

export async function markBuildArtifactsCleaned(input: MarkBuildArtifactsCleanedInput): Promise<BuildArtifactRow[]> {
  if (input.artifactIds.length === 0) {
    return [];
  }
  const rows: PersistedBuildArtifactRow[] = await getApiDatabase()
    .update(buildArtifacts)
    .set({
      fingerprint: null,
      buildState: 'failed',
      imageCleanedAt: input.cleanedAt,
      imageRetentionState: 'cleaned',
      updatedAt: input.updatedAt,
    })
    .where(inArray(buildArtifacts.id, input.artifactIds))
    .returning();
  return rows.map(toBuildArtifactRow);
}

export async function listDeploymentsBySourceResolutionTaskId(
  sourceResolutionTaskId: string,
): Promise<DeploymentRow[]> {
  const rows: PersistedDeploymentRow[] = await getApiDatabase()
    .select()
    .from(deployments)
    .where(eq(deployments.sourceResolutionTaskId, sourceResolutionTaskId));

  return rows.map(toDeploymentRow);
}

export async function createQueuedExistingArtifactDeploymentBatch(
  items: CreateQueuedExistingArtifactDeploymentBatchItem[],
): Promise<DeploymentRow[]> {
  return await getApiDatabase().transaction(async (tx: DeploymentTransaction): Promise<DeploymentRow[]> => {
    return await createQueuedExistingArtifactDeploymentBatchWithExecutor(tx, items);
  });
}

export async function createQueuedExistingArtifactDeploymentBatchWithExecutor(
  tx: DeploymentTransaction,
  items: CreateQueuedExistingArtifactDeploymentBatchItem[],
): Promise<DeploymentRow[]> {
  const queuedDeployments: DeploymentRow[] = [];

  for (const item of items) {
    const operation: OperationRecord = await insertOperationRecordWithExecutor(tx, item.operation);
    const deployment: DeploymentRow = await createDeploymentWithExecutor(tx, {
      ...item.deployment,
      operationId: operation.id,
    });

    queuedDeployments.push(deployment);
  }

  return queuedDeployments;
}

export async function findDeploymentRunDeployment(
  input: FindDeploymentRunDeploymentInput,
): Promise<DeploymentRow | undefined> {
  const [deployment] = await getApiDatabase()
    .select()
    .from(deployments)
    .where(and(eq(deployments.id, input.deploymentId), eq(deployments.deploymentRunId, input.deploymentRunId)))
    .limit(1);

  return deployment === undefined ? undefined : toDeploymentRow(deployment);
}

export async function markDeploymentFailed(input: MarkDeploymentFailedInput): Promise<DeploymentRow> {
  const [deployment] = await getApiDatabase()
    .update(deployments)
    .set({
      completedAt: input.completedAt,
      failureMessage: input.failureMessage,
      health: 'unhealthy',
      isActive: false,
      promotionStage: 'rolled_back',
      status: 'failed',
      updatedAt: input.updatedAt,
    })
    .where(eq(deployments.id, input.deploymentId))
    .returning();

  return toDeploymentRow(requirePersistedRow(deployment, 'deployment'));
}

export async function hasBlockingProjectDeployments(
  executor: Pick<Database, 'select'>,
  projectId: string,
): Promise<boolean> {
  const rows: { id: string }[] = await executor
    .select({ id: deployments.id })
    .from(deployments)
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .where(and(eq(environments.projectId, projectId), buildProjectDeleteBlockerFilter()))
    .limit(1);

  return rows[0] !== undefined;
}

export async function createDeploymentWithExecutor(
  executor: Pick<Database, 'insert'>,
  input: CreateDeploymentInput,
): Promise<DeploymentRow> {
  const [deployment] = await executor.insert(deployments).values(input).returning();
  return toDeploymentRow(requirePersistedRow(deployment, 'deployment'));
}

export { toDeploymentRow } from './deployment-row.mapper';

export function toBuildArtifactRow(row: PersistedBuildArtifactRow): BuildArtifactRow {
  return {
    ...row,
    imageRetentionState: row.imageRetentionState as BuildArtifactImageRetentionState,
  };
}

function buildProjectDeleteBlockerFilter(): SQL {
  const filter: SQL | undefined = or(
    eq(deployments.isActive, true),
    eq(deployments.status, 'queued'),
    eq(deployments.status, 'running'),
  );

  if (filter === undefined) {
    throw new Error('Expected project delete blocker filter.');
  }

  return filter;
}
