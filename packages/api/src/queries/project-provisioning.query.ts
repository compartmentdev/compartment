import { and, asc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { projectKubeProvisioning } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentTransaction } from './deployments.query.types';
import { projectProvisioningAttemptLimit, projectProvisioningTerminalFailure } from './project-provisioning-policy';
import type {
  CompleteProjectProvisioningCleanupInput,
  CompleteProjectProvisioningExecutionInput,
  CompleteProjectProvisioningInput,
  ProjectProvisioningClaimRow,
} from './project-provisioning.query.types';
import {
  deadLetterExpiredProjectProvisioning,
  failTerminalProjectProvisioning,
} from './project-provisioning-terminal.query';

const leaseDurationMs: number = 7 * 60_000;
const failedRetryDelayMs: number = 10_000;
interface CompletedProjectProvisioningRow {
  attempts: number;
  projectId: string;
}

export async function hasSucceededProjectKubeProvisioning(projectId: string): Promise<boolean> {
  const [row] = await getApiDatabase()
    .select({ projectId: projectKubeProvisioning.projectId })
    .from(projectKubeProvisioning)
    .where(and(eq(projectKubeProvisioning.projectId, projectId), eq(projectKubeProvisioning.state, 'succeeded')))
    .limit(1);
  return row !== undefined;
}

export async function claimPendingProjectProvisioning(): Promise<ProjectProvisioningClaimRow | null> {
  return await getApiDatabase().transaction(claimPendingProjectProvisioningWithTransaction);
}

async function claimPendingProjectProvisioningWithTransaction(
  transaction: DeploymentTransaction,
): Promise<ProjectProvisioningClaimRow | null> {
  const now: Date = new Date();
  await deadLetterExpiredProjectProvisioning(transaction, now);
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
    .where(claimableCondition(now))
    .orderBy(
      sql`case when ${projectKubeProvisioning.cleanupState} <> 'succeeded' then 0 when ${projectKubeProvisioning.state} = 'pending' then 1 else 2 end`,
      asc(projectKubeProvisioning.createdAt),
    )
    .limit(1)
    .for('update', { skipLocked: true });
  return rows[0];
}

function claimableCondition(now: Date): SQL | undefined {
  return or(
    cleanupClaimableCondition(now),
    and(eq(projectKubeProvisioning.cleanupState, 'succeeded'), provisioningClaimableCondition(now)),
  );
}

function cleanupClaimableCondition(now: Date): SQL | undefined {
  return or(
    eq(projectKubeProvisioning.cleanupState, 'pending'),
    and(
      eq(projectKubeProvisioning.cleanupState, 'failed'),
      lt(projectKubeProvisioning.updatedAt, new Date(now.getTime() - failedRetryDelayMs)),
    ),
    and(eq(projectKubeProvisioning.cleanupState, 'running'), lt(projectKubeProvisioning.leaseExpiresAt, now)),
  );
}

function provisioningClaimableCondition(now: Date): SQL | undefined {
  return or(
    eq(projectKubeProvisioning.state, 'pending'),
    and(
      eq(projectKubeProvisioning.state, 'failed'),
      lt(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit),
      lt(projectKubeProvisioning.updatedAt, new Date(now.getTime() - failedRetryDelayMs)),
    ),
    and(
      eq(projectKubeProvisioning.state, 'running'),
      lt(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit),
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
  if (row.cleanupState !== 'succeeded') {
    return await leaseProjectCleanup(transaction, row.projectId, leaseId, now);
  }
  return await leaseProjectExecution(transaction, row.projectId, leaseId, now);
}

async function leaseProjectCleanup(
  transaction: DeploymentTransaction,
  projectId: string,
  leaseId: string,
  now: Date,
): Promise<ProjectProvisioningClaimRow> {
  await transaction
    .update(projectKubeProvisioning)
    .set({
      cleanupFailureMessage: null,
      cleanupState: 'running',
      leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
      leaseId,
      updatedAt: now,
    })
    .where(eq(projectKubeProvisioning.projectId, projectId));
  return { action: 'cleanup', leaseId, namespaceId: projectId, projectId };
}

async function leaseProjectExecution(
  transaction: DeploymentTransaction,
  projectId: string,
  leaseId: string,
  now: Date,
): Promise<ProjectProvisioningClaimRow> {
  await transaction
    .update(projectKubeProvisioning)
    .set({
      attempts: sql`${projectKubeProvisioning.attempts} + 1`,
      failureMessage: null,
      leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
      leaseId,
      state: 'running',
      updatedAt: now,
    })
    .where(eq(projectKubeProvisioning.projectId, projectId));
  return { action: 'provision', leaseId, namespaceId: projectId, projectId };
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
  if (input.action === 'cleanup') {
    return await persistProjectProvisioningCleanupCompletion(transaction, input);
  }
  const completed: CompletedProjectProvisioningRow | undefined = await persistProjectProvisioningCompletion(
    transaction,
    input,
  );
  if (completed === undefined) {
    return false;
  }
  if (input.status === 'failed' && completed.attempts >= projectProvisioningAttemptLimit) {
    await failTerminalProjectProvisioning(
      transaction,
      completed.projectId,
      projectProvisioningTerminalFailure(input.failureMessage),
      new Date(),
    );
  }
  return true;
}

async function persistProjectProvisioningCleanupCompletion(
  transaction: DeploymentTransaction,
  input: CompleteProjectProvisioningCleanupInput,
): Promise<boolean> {
  const rows: { projectId: string }[] = await transaction
    .update(projectKubeProvisioning)
    .set({
      cleanupFailureMessage: input.failureMessage,
      cleanupState: input.status,
      leaseExpiresAt: null,
      leaseId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, input.projectId),
        eq(projectKubeProvisioning.leaseId, input.leaseId),
        eq(projectKubeProvisioning.cleanupState, 'running'),
      ),
    )
    .returning({ projectId: projectKubeProvisioning.projectId });
  return rows.length === 1;
}

async function persistProjectProvisioningCompletion(
  transaction: DeploymentTransaction,
  input: CompleteProjectProvisioningExecutionInput,
): Promise<CompletedProjectProvisioningRow | undefined> {
  const rows: CompletedProjectProvisioningRow[] = await transaction
    .update(projectKubeProvisioning)
    .set({
      cleanupFailureMessage: null,
      cleanupState: input.cleanupRequired ? 'pending' : 'succeeded',
      failureMessage: input.failureMessage,
      leaseExpiresAt: null,
      leaseId: null,
      state: input.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, input.projectId),
        eq(projectKubeProvisioning.leaseId, input.leaseId),
        eq(projectKubeProvisioning.state, 'running'),
      ),
    )
    .returning({ attempts: projectKubeProvisioning.attempts, projectId: projectKubeProvisioning.projectId });
  return rows[0];
}
