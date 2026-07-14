import { and, asc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import { projectKubeProvisioning } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentTransaction } from './deployments.query.types';
import { projectProvisioningAttemptLimit, projectProvisioningTerminalFailure } from './project-provisioning-policy';
import type { CompleteProjectProvisioningInput, ProjectProvisioningClaimRow } from './project-provisioning.query.types';
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
  return await leaseProjectProvisioning(transaction, row.projectId, now);
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
      sql`case when ${projectKubeProvisioning.state} = 'pending' then 0 else 1 end`,
      asc(projectKubeProvisioning.createdAt),
    )
    .limit(1)
    .for('update', { skipLocked: true });
  return rows[0];
}

function claimableCondition(now: Date): SQL | undefined {
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
  projectId: string,
  now: Date,
): Promise<ProjectProvisioningClaimRow> {
  const leaseId: string = createId('kpl');
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
  return { leaseId, namespaceId: projectId, projectId };
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
