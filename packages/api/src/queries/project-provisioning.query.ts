import { and, asc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ProjectProvisioningAction } from '@compartment/contracts';
import { projectKubeProvisioning } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentTransaction } from './deployments.query.types';
import {
  projectProvisioningAttemptLimit,
  projectProvisioningLeaseDurationMs,
  projectProvisioningRetryDelayMs,
  projectProvisioningTerminalFailure,
} from './project-provisioning-policy';
import type {
  CompleteProjectProvisioningInput,
  ProjectKubeProvisioningState,
  ProjectProvisioningClaimRow,
  ProjectProvisioningCompletionStatus,
} from './project-provisioning.query.types';
import { failTerminalProjectProvisioning } from './project-provisioning-terminal.query';

interface CompletedProjectProvisioningRow {
  attempts: number;
  projectId: string;
}

export async function claimPendingProjectProvisioning(): Promise<ProjectProvisioningClaimRow | null> {
  return await getApiDatabase().transaction(claimPendingProjectProvisioningWithTransaction);
}

async function claimPendingProjectProvisioningWithTransaction(
  transaction: DeploymentTransaction,
): Promise<ProjectProvisioningClaimRow | null> {
  const now: Date = new Date();
  const row: typeof projectKubeProvisioning.$inferSelect | undefined = await selectClaimableRow(transaction, now);
  if (row === undefined) {
    return null;
  }
  return await leaseProjectProvisioning(transaction, row, now);
}

async function selectClaimableRow(
  transaction: DeploymentTransaction,
  now: Date,
): Promise<typeof projectKubeProvisioning.$inferSelect | undefined> {
  const rows: (typeof projectKubeProvisioning.$inferSelect)[] = await transaction
    .select()
    .from(projectKubeProvisioning)
    .where(provisioningClaimableCondition(now))
    .orderBy(asc(projectKubeProvisioning.createdAt))
    .limit(1)
    .for('update', { skipLocked: true });
  return rows[0];
}

function provisioningClaimableCondition(now: Date): SQL | undefined {
  return or(
    eq(projectKubeProvisioning.state, 'pending'),
    eq(projectKubeProvisioning.state, 'teardown_pending'),
    and(
      or(eq(projectKubeProvisioning.state, 'failed'), eq(projectKubeProvisioning.state, 'teardown_failed')),
      lt(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit),
      lt(projectKubeProvisioning.updatedAt, new Date(now.getTime() - projectProvisioningRetryDelayMs)),
    ),
    and(
      or(eq(projectKubeProvisioning.state, 'running'), eq(projectKubeProvisioning.state, 'teardown_running')),
      lt(projectKubeProvisioning.leaseExpiresAt, now),
    ),
  );
}

async function leaseProjectProvisioning(
  transaction: DeploymentTransaction,
  row: typeof projectKubeProvisioning.$inferSelect,
  now: Date,
): Promise<ProjectProvisioningClaimRow> {
  const leaseId: string = createId('kpl');
  return await leaseProjectExecution(transaction, row, readProjectProvisioningAction(row.state), leaseId, now);
}

async function leaseProjectExecution(
  transaction: DeploymentTransaction,
  row: typeof projectKubeProvisioning.$inferSelect,
  action: ProjectProvisioningAction,
  leaseId: string,
  now: Date,
): Promise<ProjectProvisioningClaimRow> {
  await transaction
    .update(projectKubeProvisioning)
    .set({
      attempts: isRunningProjectKubeState(row.state) ? row.attempts : sql`${projectKubeProvisioning.attempts} + 1`,
      failureMessage: null,
      leaseExpiresAt: new Date(now.getTime() + projectProvisioningLeaseDurationMs),
      leaseId,
      state: action === 'provision' ? 'running' : 'teardown_running',
      updatedAt: now,
    })
    .where(eq(projectKubeProvisioning.projectId, row.projectId));
  return { action, leaseId, namespaceId: row.projectId, projectId: row.projectId };
}

export async function completeProjectProvisioning(input: CompleteProjectProvisioningInput): Promise<boolean> {
  return await getApiDatabase().transaction(
    async (transaction: DeploymentTransaction): Promise<boolean> =>
      await completeProjectProvisioningWithTransaction(transaction, input),
  );
}

async function completeProjectProvisioningWithTransaction(
  transaction: DeploymentTransaction,
  input: CompleteProjectProvisioningInput,
): Promise<boolean> {
  if (input.status === 'running') {
    return await renewProjectProvisioningLease(transaction, input, new Date());
  }
  const completed: CompletedProjectProvisioningRow | undefined = await persistProjectProvisioningCompletion(
    transaction,
    input,
  );
  if (completed === undefined) {
    return false;
  }
  if (shouldFailTerminalProvisioning(input, completed)) {
    await failTerminalProjectProvisioning(
      transaction,
      completed.projectId,
      projectProvisioningTerminalFailure(input.failureMessage),
      new Date(),
    );
  }
  return true;
}

function shouldFailTerminalProvisioning(
  input: CompleteProjectProvisioningInput,
  completed: CompletedProjectProvisioningRow,
): boolean {
  return (
    input.action === 'provision' && input.status === 'failed' && completed.attempts >= projectProvisioningAttemptLimit
  );
}

async function renewProjectProvisioningLease(
  transaction: DeploymentTransaction,
  input: CompleteProjectProvisioningInput,
  now: Date,
): Promise<boolean> {
  const rows: { projectId: string }[] = await transaction
    .update(projectKubeProvisioning)
    .set({ leaseExpiresAt: new Date(now.getTime() + projectProvisioningLeaseDurationMs), updatedAt: now })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, input.projectId),
        eq(projectKubeProvisioning.leaseId, input.leaseId),
        eq(projectKubeProvisioning.state, runningState(input.action)),
        gt(projectKubeProvisioning.leaseExpiresAt, now),
      ),
    )
    .returning({ projectId: projectKubeProvisioning.projectId });
  return rows.length === 1;
}

async function persistProjectProvisioningCompletion(
  transaction: DeploymentTransaction,
  input: CompleteProjectProvisioningInput,
): Promise<CompletedProjectProvisioningRow | undefined> {
  const rows: CompletedProjectProvisioningRow[] = await transaction
    .update(projectKubeProvisioning)
    .set({
      failureMessage: input.failureMessage,
      leaseExpiresAt: null,
      leaseId: null,
      state: completedState(input.action, input.status),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, input.projectId),
        eq(projectKubeProvisioning.leaseId, input.leaseId),
        eq(projectKubeProvisioning.state, runningState(input.action)),
      ),
    )
    .returning({ attempts: projectKubeProvisioning.attempts, projectId: projectKubeProvisioning.projectId });
  return rows[0];
}

function readProjectProvisioningAction(state: ProjectKubeProvisioningState): ProjectProvisioningAction {
  return state.startsWith('teardown_') ? 'teardown' : 'provision';
}

function isRunningProjectKubeState(state: ProjectKubeProvisioningState): boolean {
  return state === 'running' || state === 'teardown_running';
}

function runningState(action: ProjectProvisioningAction): 'running' | 'teardown_running' {
  return action === 'provision' ? 'running' : 'teardown_running';
}

function completedState(
  action: ProjectProvisioningAction,
  status: ProjectProvisioningCompletionStatus,
): 'failed' | 'succeeded' | 'teardown_failed' | 'teardown_succeeded' {
  if (status === 'running') {
    throw new Error('Running project Kubernetes work cannot be persisted as completed.');
  }
  if (action === 'provision') {
    return status;
  }
  return status === 'failed' ? 'teardown_failed' : 'teardown_succeeded';
}
