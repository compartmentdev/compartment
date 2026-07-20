import { and, eq, inArray } from 'drizzle-orm';
import {
  deploymentKubeReferences,
  deploymentRunEvents,
  deployments,
  environments,
  operations,
  projectKubeProvisioning,
  projectResources,
  resourceReconcileRuns,
} from '../db/schema';
import { createId } from '../lib/tokens';
import type { DeploymentTransaction } from './deployments.query.types';
import { projectProvisioningAttemptLimit, projectProvisioningTerminalFailure } from './project-provisioning-policy';
import type {
  ProjectProvisioningLockRow,
  TerminalProvisioningRow,
  WaitingDeploymentRow,
} from './project-provisioning-terminal.query.types';

type DeploymentRunEventInsert = typeof deploymentRunEvents.$inferInsert;

export async function lockTerminalProvisioningForDeployment(
  transaction: DeploymentTransaction,
  deploymentId: string,
): Promise<TerminalProvisioningRow | undefined> {
  return terminalProvisioningRow(await lockDeploymentProvisioning(transaction, deploymentId));
}

export async function lockTerminalProvisioningForResource(
  transaction: DeploymentTransaction,
  resourceId: string,
): Promise<TerminalProvisioningRow | undefined> {
  return terminalProvisioningRow(await lockResourceProvisioning(transaction, resourceId));
}

async function lockDeploymentProvisioning(
  transaction: DeploymentTransaction,
  deploymentId: string,
): Promise<ProjectProvisioningLockRow | undefined> {
  const [row] = await transaction
    .select({
      attempts: projectKubeProvisioning.attempts,
      failureMessage: projectKubeProvisioning.failureMessage,
      projectId: projectKubeProvisioning.projectId,
      state: projectKubeProvisioning.state,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, environments.projectId))
    .where(eq(deployments.id, deploymentId))
    .limit(1)
    .for('update', { of: projectKubeProvisioning });
  return row;
}

async function lockResourceProvisioning(
  transaction: DeploymentTransaction,
  resourceId: string,
): Promise<ProjectProvisioningLockRow | undefined> {
  const [row] = await transaction
    .select({
      attempts: projectKubeProvisioning.attempts,
      failureMessage: projectKubeProvisioning.failureMessage,
      projectId: projectKubeProvisioning.projectId,
      state: projectKubeProvisioning.state,
    })
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projectKubeProvisioning, eq(projectKubeProvisioning.projectId, environments.projectId))
    .where(eq(projectResources.id, resourceId))
    .limit(1)
    .for('update', { of: projectKubeProvisioning });
  return row;
}

function terminalProvisioningRow(row: ProjectProvisioningLockRow | undefined): TerminalProvisioningRow | undefined {
  return row !== undefined &&
    ['failed', 'policy-failed'].includes(row.state) &&
    row.attempts >= projectProvisioningAttemptLimit
    ? row
    : undefined;
}

export async function propagateTerminalProvisioningRow(
  transaction: DeploymentTransaction,
  row: TerminalProvisioningRow | undefined,
  failedAt: Date,
): Promise<void> {
  if (row !== undefined) {
    await failTerminalProjectProvisioning(
      transaction,
      row.projectId,
      projectProvisioningTerminalFailure(row.failureMessage),
      failedAt,
    );
  }
}

export async function failTerminalProjectProvisioning(
  transaction: DeploymentTransaction,
  projectId: string,
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  const operationIds: string[] = await failWaitingProjectDeployments(transaction, projectId, failureMessage, failedAt);
  const resourceRunIds: string[] = await failWaitingResourceRuns(transaction, projectId, failureMessage, failedAt);
  await failWaitingOperations(transaction, [...operationIds, ...resourceRunIds], failureMessage, failedAt);
}

async function failWaitingProjectDeployments(
  transaction: DeploymentTransaction,
  projectId: string,
  failureMessage: string,
  failedAt: Date,
): Promise<string[]> {
  const waiting: WaitingDeploymentRow[] = await findWaitingDeployments(transaction, projectId);
  const deploymentIds: string[] = waiting.map((deployment: WaitingDeploymentRow): string => deployment.deploymentId);
  if (deploymentIds.length > 0) {
    await failDeployments(transaction, deploymentIds, failureMessage, failedAt);
    await transaction.insert(deploymentRunEvents).values(provisioningFailureEvents(waiting, failureMessage, failedAt));
  }
  return waiting.map((deployment: WaitingDeploymentRow): string => deployment.operationId);
}

async function findWaitingDeployments(
  transaction: DeploymentTransaction,
  projectId: string,
): Promise<WaitingDeploymentRow[]> {
  return await transaction
    .select({
      deploymentId: deployments.id,
      deploymentRunId: deployments.deploymentRunId,
      operationId: deployments.operationId,
    })
    .from(deployments)
    .innerJoin(environments, eq(environments.id, deployments.environmentId))
    .innerJoin(deploymentKubeReferences, eq(deploymentKubeReferences.deploymentId, deployments.id))
    .where(
      and(
        eq(environments.projectId, projectId),
        eq(deployments.status, 'running'),
        inArray(deploymentKubeReferences.state, ['desired', 'pending']),
      ),
    );
}

async function failDeployments(
  transaction: DeploymentTransaction,
  deploymentIds: string[],
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  await transaction
    .update(deployments)
    .set({
      completedAt: failedAt,
      failureMessage,
      health: 'unhealthy',
      status: 'failed',
      updatedAt: failedAt,
    })
    .where(inArray(deployments.id, deploymentIds));
}

function provisioningFailureEvents(
  waiting: WaitingDeploymentRow[],
  failureMessage: string,
  failedAt: Date,
): DeploymentRunEventInsert[] {
  return waiting.map(
    (deployment: WaitingDeploymentRow): DeploymentRunEventInsert => ({
      createdAt: failedAt,
      deploymentId: deployment.deploymentId,
      deploymentRunId: deployment.deploymentRunId,
      id: createId('drev'),
      level: 'error',
      message: failureMessage,
      status: 'failed',
      stepKey: 'provisioning',
      stream: 'compartment',
    }),
  );
}

async function failWaitingResourceRuns(
  transaction: DeploymentTransaction,
  projectId: string,
  failureMessage: string,
  failedAt: Date,
): Promise<string[]> {
  const runIds: string[] = await findWaitingResourceRunIds(transaction, projectId);
  if (runIds.length > 0) {
    await transaction
      .update(resourceReconcileRuns)
      .set({ failureMessage, leaseExpiresAt: null, leaseId: null, phase: 'failed', updatedAt: failedAt })
      .where(inArray(resourceReconcileRuns.id, runIds));
  }
  return runIds;
}

async function findWaitingResourceRunIds(transaction: DeploymentTransaction, projectId: string): Promise<string[]> {
  const runs: { id: string }[] = await transaction
    .select({ id: resourceReconcileRuns.id })
    .from(resourceReconcileRuns)
    .innerJoin(projectResources, eq(projectResources.id, resourceReconcileRuns.projectResourceId))
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .where(
      and(
        eq(environments.projectId, projectId),
        inArray(resourceReconcileRuns.phase, ['bootstrap-pending', 'reconcile-pending']),
      ),
    );
  return runs.map((run: { id: string }): string => run.id);
}

async function failWaitingOperations(
  transaction: DeploymentTransaction,
  operationIds: string[],
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  if (operationIds.length === 0) {
    return;
  }
  await transaction
    .update(operations)
    .set({ completedAt: failedAt, status: 'failed', summary: failureMessage })
    .where(inArray(operations.id, operationIds));
}
