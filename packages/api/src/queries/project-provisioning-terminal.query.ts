import { and, eq, gte, inArray, lt, or } from 'drizzle-orm';
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
import {
  expiredProjectProvisioningLeaseMessage,
  projectProvisioningAttemptLimit,
  projectProvisioningTerminalFailure,
} from './project-provisioning-policy';

interface TerminalProvisioningRow {
  failureMessage: string | null;
  projectId: string;
}

interface WaitingDeploymentRow {
  deploymentId: string;
  deploymentRunId: string;
}

type DeploymentRunEventInsert = typeof deploymentRunEvents.$inferInsert;

export async function deadLetterExpiredProjectProvisioning(
  transaction: DeploymentTransaction,
  now: Date,
): Promise<void> {
  const rows: TerminalProvisioningRow[] = await persistExpiredProjectProvisioning(transaction, now);
  for (const row of rows) {
    await failTerminalProjectProvisioning(
      transaction,
      row.projectId,
      projectProvisioningTerminalFailure(row.failureMessage),
      now,
    );
  }
}

export async function failTerminalProjectProvisioning(
  transaction: DeploymentTransaction,
  projectId: string,
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  const deploymentIds: string[] = await failWaitingProjectDeployments(transaction, projectId, failureMessage, failedAt);
  const resourceRunIds: string[] = await failWaitingResourceRuns(transaction, projectId, failureMessage, failedAt);
  await failWaitingOperations(transaction, [...deploymentIds, ...resourceRunIds], failureMessage, failedAt);
}

async function persistExpiredProjectProvisioning(
  transaction: DeploymentTransaction,
  now: Date,
): Promise<TerminalProvisioningRow[]> {
  return await transaction
    .update(projectKubeProvisioning)
    .set({
      failureMessage: expiredProjectProvisioningLeaseMessage,
      leaseExpiresAt: null,
      leaseId: null,
      state: 'failed',
      updatedAt: now,
    })
    .where(
      and(
        eq(projectKubeProvisioning.state, 'running'),
        gte(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit),
        lt(projectKubeProvisioning.leaseExpiresAt, now),
      ),
    )
    .returning({
      failureMessage: projectKubeProvisioning.failureMessage,
      projectId: projectKubeProvisioning.projectId,
    });
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
  return deploymentIds;
}

async function findWaitingDeployments(
  transaction: DeploymentTransaction,
  projectId: string,
): Promise<WaitingDeploymentRow[]> {
  return await transaction
    .select({ deploymentId: deployments.id, deploymentRunId: deployments.deploymentRunId })
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
  targetIds: string[],
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  if (targetIds.length === 0) {
    return;
  }
  await transaction
    .update(operations)
    .set({ completedAt: failedAt, status: 'failed', summary: failureMessage })
    .where(or(inArray(operations.id, targetIds), inArray(operations.targetId, targetIds)));
}
