import { and, asc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ProjectProvisioningAction } from '@compartment/contracts';
import { projectKubeProvisioning } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import { claimSelectedRow } from './claim-row.query.shared';
import type { DeploymentTransaction } from './deployments.query.types';
import {
  projectProvisioningAttemptLimit,
  projectProvisioningLeaseDuration,
  projectProvisioningRetryDelayMs,
  projectTeardownTerminalFailure,
} from './project-provisioning-policy';
import type {
  ProjectKubeProvisioningState,
  ProjectProvisioningClaimPhase,
  ProjectProvisioningClaimRow,
} from './project-provisioning.query.types';

export async function claimPendingProjectProvisioning(
  action: ProjectProvisioningAction | 'any' = 'any',
): Promise<ProjectProvisioningClaimRow | null> {
  return await getApiDatabase().transaction(
    async (transaction: DeploymentTransaction): Promise<ProjectProvisioningClaimRow | null> =>
      await claimPendingProjectProvisioningWithTransaction(transaction, action),
  );
}

async function claimPendingProjectProvisioningWithTransaction(
  transaction: DeploymentTransaction,
  action: ProjectProvisioningAction | 'any',
): Promise<ProjectProvisioningClaimRow | null> {
  const now: Date = new Date();
  return await claimSelectedRow(
    transaction,
    async (tx: DeploymentTransaction): Promise<typeof projectKubeProvisioning.$inferSelect | undefined> =>
      await selectClaimableRow(tx, now, action),
    async (
      tx: DeploymentTransaction,
      row: typeof projectKubeProvisioning.$inferSelect,
    ): Promise<ProjectProvisioningClaimRow> => await leaseProjectProvisioning(tx, row, now),
    null,
  );
}

export async function failExhaustedProjectTeardownLeases(): Promise<string[]> {
  return await getApiDatabase().transaction(
    async (transaction: DeploymentTransaction): Promise<string[]> =>
      await failExhaustedProjectTeardownLeasesWithTransaction(transaction, new Date()),
  );
}

async function failExhaustedProjectTeardownLeasesWithTransaction(
  transaction: DeploymentTransaction,
  now: Date,
): Promise<string[]> {
  const rows: { projectId: string }[] = await transaction
    .update(projectKubeProvisioning)
    .set({
      failureMessage: projectTeardownTerminalFailure('The final teardown lease expired.'),
      leaseExpiresAt: null,
      leaseId: null,
      state: 'teardown_failed',
      updatedAt: now,
    })
    .where(
      and(
        eq(projectKubeProvisioning.state, 'teardown_running'),
        lt(projectKubeProvisioning.leaseExpiresAt, now),
        gt(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit - 1),
      ),
    )
    .returning({ projectId: projectKubeProvisioning.projectId });
  return rows.map((row: { projectId: string }): string => row.projectId);
}

async function selectClaimableRow(
  transaction: DeploymentTransaction,
  now: Date,
  action: ProjectProvisioningAction | 'any',
): Promise<typeof projectKubeProvisioning.$inferSelect | undefined> {
  const rows: (typeof projectKubeProvisioning.$inferSelect)[] = await transaction
    .select()
    .from(projectKubeProvisioning)
    .where(provisioningClaimableCondition(now, action))
    .orderBy(asc(projectKubeProvisioning.createdAt))
    .limit(1)
    .for('update', { skipLocked: true });
  return rows[0];
}

function provisioningClaimableCondition(now: Date, action: ProjectProvisioningAction | 'any'): SQL | undefined {
  return or(
    claimableStateCondition(action, 'pending'),
    claimableFailedCondition(action, now),
    claimableExpiredRunningCondition(action, now),
  );
}

function claimableFailedCondition(action: ProjectProvisioningAction | 'any', now: Date): SQL | undefined {
  const retryReady: SQL = lt(
    projectKubeProvisioning.updatedAt,
    new Date(now.getTime() - projectProvisioningRetryDelayMs),
  );
  const failedProvisioning: SQL | undefined = and(
    eq(projectKubeProvisioning.state, 'failed'),
    lt(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit),
    retryReady,
  );
  const failedTeardown: SQL | undefined = and(
    eq(projectKubeProvisioning.state, 'teardown_failed'),
    lt(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit),
    retryReady,
  );
  if (action === 'provision') {
    return failedProvisioning;
  }
  if (action === 'teardown') {
    return failedTeardown;
  }
  return or(failedProvisioning, failedTeardown);
}

function claimableExpiredRunningCondition(action: ProjectProvisioningAction | 'any', now: Date): SQL | undefined {
  const expiredProvisioning: SQL | undefined = and(
    eq(projectKubeProvisioning.state, 'running'),
    lt(projectKubeProvisioning.leaseExpiresAt, now),
  );
  const expiredTeardown: SQL | undefined = and(
    eq(projectKubeProvisioning.state, 'teardown_running'),
    lt(projectKubeProvisioning.attempts, projectProvisioningAttemptLimit),
    lt(projectKubeProvisioning.leaseExpiresAt, now),
  );
  if (action === 'provision') {
    return expiredProvisioning;
  }
  if (action === 'teardown') {
    return expiredTeardown;
  }
  return or(expiredProvisioning, expiredTeardown);
}

function claimableStateCondition(
  action: ProjectProvisioningAction | 'any',
  phase: ProjectProvisioningClaimPhase,
): SQL | undefined {
  if (action === 'any') {
    return or(eq(projectKubeProvisioning.state, phase), eq(projectKubeProvisioning.state, `teardown_${phase}`));
  }
  const state: ProjectKubeProvisioningState = action === 'provision' ? phase : `teardown_${phase}`;
  return eq(projectKubeProvisioning.state, state);
}

async function leaseProjectProvisioning(
  transaction: DeploymentTransaction,
  row: typeof projectKubeProvisioning.$inferSelect,
  now: Date,
): Promise<ProjectProvisioningClaimRow> {
  const leaseId: string = createId('kpl');
  const action: ProjectProvisioningAction = readProjectProvisioningAction(row.state);
  await transaction
    .update(projectKubeProvisioning)
    .set({
      attempts:
        row.state === 'running' || row.state === 'teardown_running'
          ? row.attempts
          : sql`${projectKubeProvisioning.attempts} + 1`,
      failureMessage: null,
      leaseExpiresAt: new Date(now.getTime() + projectProvisioningLeaseDuration(action)),
      leaseId,
      state: action === 'provision' ? 'running' : 'teardown_running',
      updatedAt: now,
    })
    .where(eq(projectKubeProvisioning.projectId, row.projectId));
  return { action, leaseId, namespaceId: row.projectId, projectId: row.projectId };
}

function readProjectProvisioningAction(state: ProjectKubeProvisioningState): ProjectProvisioningAction {
  return state.startsWith('teardown_') ? 'teardown' : 'provision';
}
