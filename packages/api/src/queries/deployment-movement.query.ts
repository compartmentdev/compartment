import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { QueryResult } from 'pg';
import { deployments, operations } from '../db/schema';
import type { DeploymentTransaction } from './deployments.query.types';
import type { DeploymentMovementTargetSelector, PersistedTargetDeploymentRow } from './deployment-movement.query.types';
import { groupTargetDeploymentsByTarget, readDeploymentMovementTargetKey } from './deployment-movement-target.query';

const inFlightMovementStatuses: ['queued', 'running'] = ['queued', 'running'];
const movementOperationTypes: ['deployment.promote', 'deployment.rollback'] = [
  'deployment.promote',
  'deployment.rollback',
];

export async function acquireDeploymentMovementTargetLocks(
  tx: DeploymentTransaction,
  targets: DeploymentMovementTargetSelector[],
): Promise<void> {
  for (const target of targets) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(
        hashtext(${target.environmentId}),
        hashtext(${target.projectServiceId})
      )`,
    );
  }
}

export async function listTargetDeploymentsByTarget(
  tx: DeploymentTransaction,
  targets: DeploymentMovementTargetSelector[],
): Promise<Map<string, PersistedTargetDeploymentRow[]>> {
  if (targets.length === 0) {
    return new Map<string, PersistedTargetDeploymentRow[]>();
  }

  const latestRows: PersistedTargetDeploymentRow[] = await listLatestTargetDeploymentsByTarget(tx, targets);
  const inFlightRows: PersistedTargetDeploymentRow[] = await listInFlightTargetMovementDeploymentsByTarget(tx, targets);

  return groupTargetDeploymentsByTarget(mergeTargetDeploymentRows(latestRows, inFlightRows));
}

async function listLatestTargetDeploymentsByTarget(
  tx: DeploymentTransaction,
  targets: DeploymentMovementTargetSelector[],
): Promise<PersistedTargetDeploymentRow[]> {
  const latestDeploymentIds: string[] = await listLatestTargetDeploymentIdsByTarget(tx, targets);
  if (latestDeploymentIds.length === 0) {
    return [];
  }

  return await tx
    .select({
      deployment: deployments,
      operationType: operations.type,
    })
    .from(deployments)
    .innerJoin(operations, eq(deployments.operationId, operations.id))
    .where(inArray(deployments.id, latestDeploymentIds))
    .orderBy(
      deployments.environmentId,
      deployments.projectServiceId,
      desc(deployments.createdAt),
      desc(deployments.id),
    );
}

async function listLatestTargetDeploymentIdsByTarget(
  tx: DeploymentTransaction,
  targets: DeploymentMovementTargetSelector[],
): Promise<string[]> {
  const result: QueryResult<{ deploymentId: string }> = await tx.execute<{ deploymentId: string }>(
    sql<{ deploymentId: string }>`
      select candidate.deployment_id as "deploymentId"
      from (
        select
          ${deployments.id} as deployment_id,
          row_number() over (
            partition by ${deployments.environmentId}, ${deployments.projectServiceId}
            order by ${deployments.createdAt} desc, ${deployments.id} desc
          ) as target_rank
        from ${deployments}
        where ${buildDeploymentMovementTargetsFilter(targets)}
      ) as candidate
      where candidate.target_rank = 1
    `,
  );

  return result.rows.map((row: { deploymentId: string }): string => row.deploymentId);
}

async function listInFlightTargetMovementDeploymentsByTarget(
  tx: DeploymentTransaction,
  targets: DeploymentMovementTargetSelector[],
): Promise<PersistedTargetDeploymentRow[]> {
  return await tx
    .select({
      deployment: deployments,
      operationType: operations.type,
    })
    .from(deployments)
    .innerJoin(operations, eq(deployments.operationId, operations.id))
    .where(
      and(
        buildDeploymentMovementTargetsFilter(targets),
        inArray(deployments.status, inFlightMovementStatuses),
        inArray(operations.type, movementOperationTypes),
      ),
    )
    .orderBy(
      deployments.environmentId,
      deployments.projectServiceId,
      desc(deployments.createdAt),
      desc(deployments.id),
    );
}

function mergeTargetDeploymentRows(
  latestRows: PersistedTargetDeploymentRow[],
  inFlightRows: PersistedTargetDeploymentRow[],
): PersistedTargetDeploymentRow[] {
  const mergedRows: PersistedTargetDeploymentRow[] = [...latestRows];
  const seenDeploymentIds: Set<string> = new Set<string>(
    latestRows.map((row: PersistedTargetDeploymentRow): string => row.deployment.id),
  );

  for (const row of inFlightRows) {
    if (seenDeploymentIds.has(row.deployment.id)) {
      continue;
    }

    mergedRows.push(row);
    seenDeploymentIds.add(row.deployment.id);
  }

  return mergedRows;
}

function buildDeploymentMovementTargetsFilter(targets: DeploymentMovementTargetSelector[]): SQL {
  const targetFilters: SQL[] = [...collectMovementTargetFilters(targets).values()];

  return sql`(${sql.join(targetFilters, sql` or `)})`;
}

function collectMovementTargetFilters(targets: DeploymentMovementTargetSelector[]): Map<string, SQL> {
  const targetFilters: Map<string, SQL> = new Map<string, SQL>();

  for (const target of targets) {
    targetFilters.set(
      readDeploymentMovementTargetKey(target),
      sql`(${eq(deployments.environmentId, target.environmentId)}
        and ${eq(deployments.projectServiceId, target.projectServiceId)})`,
    );
  }

  return targetFilters;
}
