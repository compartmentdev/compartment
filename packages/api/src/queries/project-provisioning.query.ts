import { and, asc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import { projectKubeProvisioning } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentTransaction } from './deployments.query.types';
import {
  projectProvisioningAttemptLimit,
  projectProvisioningGeneration,
  projectProvisioningLeaseDurationMs,
  projectProvisioningRetryDelayMs,
  projectProvisioningTerminalFailure,
} from './project-provisioning-policy';
import type { CompleteProjectProvisioningInput, ProjectProvisioningClaimRow } from './project-provisioning.query.types';
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
  const retryBefore: Date = new Date(now.getTime() - projectProvisioningRetryDelayMs);
  return or(
    and(
      lt(projectKubeProvisioning.policyGeneration, projectProvisioningGeneration),
      or(
        eq(projectKubeProvisioning.state, 'pending'),
        eq(projectKubeProvisioning.state, 'succeeded'),
        and(eq(projectKubeProvisioning.state, 'failed'), lt(projectKubeProvisioning.updatedAt, retryBefore)),
        and(eq(projectKubeProvisioning.state, 'running'), lt(projectKubeProvisioning.leaseExpiresAt, now)),
      ),
    ),
    and(
      eq(projectKubeProvisioning.policyGeneration, projectProvisioningGeneration),
      or(
        and(
          eq(projectKubeProvisioning.state, 'policy-failed'),
          lt(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit),
          lt(projectKubeProvisioning.updatedAt, retryBefore),
        ),
        and(eq(projectKubeProvisioning.state, 'policy-running'), lt(projectKubeProvisioning.leaseExpiresAt, now)),
      ),
    ),
  );
}

async function leaseProjectProvisioning(
  transaction: DeploymentTransaction,
  row: typeof projectKubeProvisioning.$inferSelect,
  now: Date,
): Promise<ProjectProvisioningClaimRow> {
  const leaseId: string = createId('kpl');
  return await leaseProjectExecution(transaction, row, leaseId, now);
}

async function leaseProjectExecution(
  transaction: DeploymentTransaction,
  row: typeof projectKubeProvisioning.$inferSelect,
  leaseId: string,
  now: Date,
): Promise<ProjectProvisioningClaimRow> {
  await transaction
    .update(projectKubeProvisioning)
    .set({
      attempts: nextProvisioningAttempt(row),
      failureMessage: null,
      leaseExpiresAt: new Date(now.getTime() + projectProvisioningLeaseDurationMs),
      leaseId,
      policyGeneration: projectProvisioningGeneration,
      state: 'policy-running',
      updatedAt: now,
    })
    .where(eq(projectKubeProvisioning.projectId, row.projectId));
  return { generation: projectProvisioningGeneration, leaseId, namespaceId: row.projectId, projectId: row.projectId };
}

function nextProvisioningAttempt(row: typeof projectKubeProvisioning.$inferSelect): SQL {
  if (row.state === 'policy-running') {
    return sql`${projectKubeProvisioning.attempts}`;
  }
  if (row.state === 'policy-failed') {
    return sql`${projectKubeProvisioning.attempts} + 1`;
  }
  return sql`1`;
}

export async function completeProjectProvisioning(input: CompleteProjectProvisioningInput): Promise<boolean> {
  if (input.generation !== projectProvisioningGeneration) {
    return false;
  }
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
        eq(projectKubeProvisioning.state, 'policy-running'),
        eq(projectKubeProvisioning.policyGeneration, input.generation),
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
      state: input.status === 'succeeded' ? 'succeeded' : 'policy-failed',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, input.projectId),
        eq(projectKubeProvisioning.leaseId, input.leaseId),
        eq(projectKubeProvisioning.state, 'policy-running'),
        eq(projectKubeProvisioning.policyGeneration, input.generation),
      ),
    )
    .returning({ attempts: projectKubeProvisioning.attempts, projectId: projectKubeProvisioning.projectId });
  return rows[0];
}
