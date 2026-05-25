import { and, desc, eq } from 'drizzle-orm';
import type { DeploymentRunTriggerType } from '@compartment/contracts';
import type { Database } from '../db/client';
import { deploymentRuns, deployments, environments, projects } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  type CreateDeploymentRunInput,
  type DeploymentRunRow,
  type FindDeploymentRunByProjectInput,
  type PersistedDeploymentRunRow,
} from './deployment-runs.query.types';
import { requirePersistedRow } from './persisted-row.query.shared';

export async function createDeploymentRun(input: CreateDeploymentRunInput): Promise<DeploymentRunRow> {
  return await createDeploymentRunWithExecutor(getApiDatabase(), input);
}

async function createDeploymentRunWithExecutor(
  executor: Pick<Database, 'insert'>,
  input: CreateDeploymentRunInput,
): Promise<DeploymentRunRow> {
  const [run] = await executor.insert(deploymentRuns).values(buildDeploymentRunInsertValues(input)).returning();

  return toDeploymentRunRow(requirePersistedRow(run, 'deployment run'));
}

export async function findDeploymentRunByProject(
  input: FindDeploymentRunByProjectInput,
): Promise<DeploymentRunRow | undefined> {
  const [row] = await getApiDatabase()
    .select({ run: deploymentRuns })
    .from(deploymentRuns)
    .innerJoin(environments, eq(environments.id, deploymentRuns.environmentId))
    .where(
      and(
        eq(deploymentRuns.id, input.deploymentRunId),
        eq(environments.projectId, input.projectId),
        ...(input.environmentName === undefined ? [] : [eq(environments.name, input.environmentName)]),
      ),
    )
    .limit(1);

  return row === undefined ? undefined : toDeploymentRunRow(row.run);
}

export async function findLatestDeploymentRunByOnboardingSessionId(
  onboardingSessionId: string,
  organizationId: string,
): Promise<DeploymentRunRow | undefined> {
  const [row] = await getApiDatabase()
    .select({ run: deploymentRuns })
    .from(deploymentRuns)
    .innerJoin(environments, eq(environments.id, deploymentRuns.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(
      and(eq(deploymentRuns.onboardingSessionId, onboardingSessionId), eq(projects.organizationId, organizationId)),
    )
    .orderBy(desc(deploymentRuns.createdAt), desc(deploymentRuns.id))
    .limit(1);

  return row === undefined ? undefined : toDeploymentRunRow(row.run);
}

export async function findLatestDeploymentRunForEnvironment(
  environmentId: string,
  projectServiceId: string | undefined,
): Promise<DeploymentRunRow | undefined> {
  const row: PersistedDeploymentRunRow | undefined =
    projectServiceId === undefined
      ? (
          await getApiDatabase()
            .select()
            .from(deploymentRuns)
            .where(eq(deploymentRuns.environmentId, environmentId))
            .orderBy(desc(deploymentRuns.createdAt), desc(deploymentRuns.id))
            .limit(1)
        )[0]
      : await findLatestDeploymentRunForService(environmentId, projectServiceId);

  return row === undefined ? undefined : toDeploymentRunRow(row);
}

async function findLatestDeploymentRunForService(
  environmentId: string,
  projectServiceId: string,
): Promise<PersistedDeploymentRunRow | undefined> {
  const rows: { run: PersistedDeploymentRunRow }[] = await getApiDatabase()
    .select({ run: deploymentRuns })
    .from(deploymentRuns)
    .innerJoin(deployments, eq(deployments.deploymentRunId, deploymentRuns.id))
    .where(and(eq(deploymentRuns.environmentId, environmentId), eq(deployments.projectServiceId, projectServiceId)))
    .orderBy(desc(deploymentRuns.createdAt), desc(deploymentRuns.id))
    .limit(1);

  return rows[0]?.run;
}

export async function deleteDeploymentRunById(deploymentRunId: string): Promise<void> {
  await getApiDatabase().delete(deploymentRuns).where(eq(deploymentRuns.id, deploymentRunId));
}

function toDeploymentRunRow(row: PersistedDeploymentRunRow): DeploymentRunRow {
  return {
    ...row,
    triggerType: row.triggerType as DeploymentRunTriggerType,
  };
}

function buildDeploymentRunInsertValues(input: CreateDeploymentRunInput): PersistedDeploymentRunRow {
  return {
    createdAt: input.createdAt ?? input.updatedAt,
    environmentId: input.environmentId,
    id: input.id,
    label: input.label ?? null,
    onboardingSessionId: input.onboardingSessionId ?? null,
    sourceAutomationPrincipalId: input.sourceAutomationPrincipalId ?? null,
    sourceBindingId: input.sourceBindingId ?? null,
    sourceBindingSnapshotJson: input.sourceBindingSnapshotJson ?? null,
    sourceCommitSha: input.sourceCommitSha ?? null,
    sourceEventId: input.sourceEventId ?? null,
    sourceId: input.sourceId ?? null,
    sourceKind: input.sourceKind ?? null,
    sourceRepositorySnapshotJson: input.sourceRepositorySnapshotJson ?? null,
    sourceResolutionTaskId: input.sourceResolutionTaskId ?? null,
    triggerType: input.triggerType,
    updatedAt: input.updatedAt,
  };
}
