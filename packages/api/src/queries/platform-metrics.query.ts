import { sql } from 'drizzle-orm';
import type { QueryResult } from 'pg';
import type { Database } from '../db/client';
import { deploymentKubeReferences, deployments, environments, projectKubeProvisioning, projects } from '../db/schema';
import { projectProvisioningAttemptLimit } from './project-provisioning-policy';
import type {
  PlatformBuildQueueQueryRow,
  PlatformBuildQueueRow,
  PlatformDeploymentStatusRow,
  PlatformMetricsSnapshot,
  PlatformProvisioningStateRow,
  PlatformProvisioningSummaryRow,
} from './platform-metrics.query.types';

export async function readPlatformMetricsSnapshot(db: Database): Promise<PlatformMetricsSnapshot> {
  const [buildQueue, deploymentsByStatus, provisioning, provisioningSummary] = await Promise.all([
    readBuildQueue(db),
    readDeploymentsByStatus(db),
    readProvisioningByState(db),
    readProvisioningSummary(db),
  ]);
  return { buildQueue, deployments: deploymentsByStatus, provisioning, provisioningSummary };
}

async function readBuildQueue(db: Database): Promise<PlatformBuildQueueRow[]> {
  const result: QueryResult<PlatformBuildQueueQueryRow> = await db.execute<PlatformBuildQueueQueryRow>(
    sql<PlatformBuildQueueQueryRow>`
      select
        count(*) filter (where ${deployments.status} = 'running' and not exists (
          select 1 from ${deploymentKubeReferences}
          where ${deploymentKubeReferences.deploymentId} = ${deployments.id}
        ))::integer as active,
        min(${deployments.createdAt}) filter (where ${deployments.status} = 'queued') as "oldestQueuedAt",
        ${projects.organizationId} as "organizationId",
        count(*) filter (where ${deployments.status} = 'queued')::integer as queued,
        count(*) filter (where ${deployments.status} = 'running')::integer as running
      from ${deployments}
      inner join ${environments} on ${deployments.environmentId} = ${environments.id}
      inner join ${projects} on ${environments.projectId} = ${projects.id}
      where ${deployments.status} in ('queued', 'running')
      group by grouping sets ((${projects.organizationId}), ())
      order by ${projects.organizationId} nulls first
    `,
  );
  return result.rows.map(toPlatformBuildQueueRow);
}

async function readDeploymentsByStatus(db: Database): Promise<PlatformDeploymentStatusRow[]> {
  const result: QueryResult<PlatformDeploymentStatusRow> = await db.execute<PlatformDeploymentStatusRow>(
    sql<PlatformDeploymentStatusRow>`
      select ${deployments.status} as status, count(*)::integer as count
      from ${deployments}
      where ${deployments.status} in ('queued', 'running', 'succeeded', 'failed', 'stopped')
      group by ${deployments.status}
    `,
  );
  return result.rows;
}

async function readProvisioningByState(db: Database): Promise<PlatformProvisioningStateRow[]> {
  const result: QueryResult<PlatformProvisioningStateRow> = await db.execute<PlatformProvisioningStateRow>(
    sql<PlatformProvisioningStateRow>`
      select ${projectKubeProvisioning.state} as state, count(*)::integer as count
      from ${projectKubeProvisioning}
      group by ${projectKubeProvisioning.state}
    `,
  );
  return result.rows;
}

async function readProvisioningSummary(db: Database): Promise<PlatformProvisioningSummaryRow> {
  const result: QueryResult<PlatformProvisioningSummaryRow> = await db.execute<PlatformProvisioningSummaryRow>(
    sql<PlatformProvisioningSummaryRow>`
      select
        coalesce(sum(${projectKubeProvisioning.attempts}), 0)::integer as attempts,
        count(*) filter (
          where ${projectKubeProvisioning.state} = 'failed'
            and ${projectKubeProvisioning.attempts} >= ${projectProvisioningAttemptLimit}
        )::integer as "permanentlyUnprovisionable"
      from ${projectKubeProvisioning}
    `,
  );
  return result.rows[0] ?? { attempts: 0, permanentlyUnprovisionable: 0 };
}

function toPlatformBuildQueueRow(row: PlatformBuildQueueQueryRow): PlatformBuildQueueRow {
  return {
    active: row.active,
    oldestQueuedAt: row.oldestQueuedAt === null ? null : new Date(row.oldestQueuedAt),
    organizationId: row.organizationId,
    queued: row.queued,
    running: row.running,
  };
}
