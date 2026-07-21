import { and, eq } from 'drizzle-orm';
import { projectKubeProvisioning } from '../db/schema';
import { createId } from '../lib/tokens';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentTransaction } from './deployments.query.types';
import {
  projectProvisioningAttemptLimit,
  projectTeardownPreparationLeaseDurationMs,
} from './project-provisioning-policy';
import type {
  ProjectKubeProvisioningState,
  ProjectTeardownObservation,
  ProjectTeardownPreparationResult,
  ProjectTeardownState,
} from './project-provisioning.query.types';

export async function prepareProjectTeardownWithTransaction(
  transaction: DeploymentTransaction,
  projectId: string,
): Promise<ProjectTeardownPreparationResult> {
  const row: typeof projectKubeProvisioning.$inferSelect | undefined = await lockProjectKubeLifecycle(
    transaction,
    projectId,
  );
  assertProjectKubeLifecycleFound(row);
  const now: Date = new Date();
  if (teardownPreparationAlreadyActive(row, now)) {
    return emptyProjectTeardownPreparation();
  }
  const recoveredTerminalFailureMessage: string | null = recoverableTeardownFailureMessage(row);
  return {
    preparationLeaseId: await leaseProjectTeardownPreparation(
      transaction,
      row.projectId,
      recoveredTerminalFailureMessage,
      now,
    ),
    recoveredTerminalFailureMessage,
  };
}

function assertProjectKubeLifecycleFound(
  row: typeof projectKubeProvisioning.$inferSelect | undefined,
): asserts row is typeof projectKubeProvisioning.$inferSelect {
  if (row === undefined) {
    throw new Error('Project Kubernetes lifecycle state not found.');
  }
}

function teardownPreparationAlreadyActive(row: typeof projectKubeProvisioning.$inferSelect, now: Date): boolean {
  const preparationLeaseActive: boolean =
    row.state === 'teardown_preparing' && row.leaseExpiresAt !== null && row.leaseExpiresAt > now;
  return preparationLeaseActive || teardownAlreadyActive(row);
}

async function leaseProjectTeardownPreparation(
  transaction: DeploymentTransaction,
  projectId: string,
  recoveredTerminalFailureMessage: string | null,
  now: Date,
): Promise<string> {
  const preparationLeaseId: string = createId('kpl');
  await transaction
    .update(projectKubeProvisioning)
    .set({
      attempts: 0,
      failureMessage: recoveredTerminalFailureMessage,
      leaseExpiresAt: new Date(now.getTime() + projectTeardownPreparationLeaseDurationMs),
      leaseId: preparationLeaseId,
      state: 'teardown_preparing',
      updatedAt: now,
    })
    .where(eq(projectKubeProvisioning.projectId, projectId));
  return preparationLeaseId;
}

function recoverableTeardownFailureMessage(row: typeof projectKubeProvisioning.$inferSelect): string | null {
  const terminalFailure: boolean =
    row.state === 'teardown_preparing' ||
    (row.state === 'teardown_failed' && row.attempts >= projectProvisioningAttemptLimit);
  return terminalFailure ? row.failureMessage : null;
}

function emptyProjectTeardownPreparation(): ProjectTeardownPreparationResult {
  return { preparationLeaseId: null, recoveredTerminalFailureMessage: null };
}

export async function activateProjectTeardownWithTransaction(
  transaction: DeploymentTransaction,
  projectId: string,
  preparationLeaseId: string,
): Promise<void> {
  const row: typeof projectKubeProvisioning.$inferSelect | undefined = await lockProjectKubeLifecycle(
    transaction,
    projectId,
  );
  if (row?.state !== 'teardown_preparing' || row.leaseId !== preparationLeaseId) {
    throw new Error('Project Kubernetes teardown is not ready to activate.');
  }
  await resetProjectTeardown(transaction, projectId, 'teardown_pending');
}

export async function releaseProjectTeardownPreparation(projectId: string, preparationLeaseId: string): Promise<void> {
  await getApiDatabase()
    .update(projectKubeProvisioning)
    .set({ leaseExpiresAt: new Date(0), updatedAt: new Date() })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, projectId),
        eq(projectKubeProvisioning.leaseId, preparationLeaseId),
        eq(projectKubeProvisioning.state, 'teardown_preparing'),
      ),
    );
}

export async function renewProjectTeardownPreparation(projectId: string, preparationLeaseId: string): Promise<boolean> {
  const now: Date = new Date();
  const rows: { projectId: string }[] = await getApiDatabase()
    .update(projectKubeProvisioning)
    .set({
      leaseExpiresAt: new Date(now.getTime() + projectTeardownPreparationLeaseDurationMs),
      updatedAt: now,
    })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, projectId),
        eq(projectKubeProvisioning.leaseId, preparationLeaseId),
        eq(projectKubeProvisioning.state, 'teardown_preparing'),
      ),
    )
    .returning({ projectId: projectKubeProvisioning.projectId });
  return rows.length === 1;
}

async function resetProjectTeardown(
  transaction: DeploymentTransaction,
  projectId: string,
  state: 'teardown_pending' | 'teardown_preparing',
): Promise<void> {
  await transaction
    .update(projectKubeProvisioning)
    .set({
      attempts: 0,
      failureMessage: null,
      leaseExpiresAt: null,
      leaseId: null,
      state,
      updatedAt: new Date(),
    })
    .where(eq(projectKubeProvisioning.projectId, projectId));
}

function teardownAlreadyActive(row: typeof projectKubeProvisioning.$inferSelect): boolean {
  return (
    row.state === 'teardown_pending' ||
    row.state === 'teardown_running' ||
    row.state === 'teardown_succeeded' ||
    (row.state === 'teardown_failed' && row.attempts < projectProvisioningAttemptLimit)
  );
}

export async function readProjectTeardownState(projectId: string): Promise<ProjectTeardownObservation | null> {
  const rows: { attempts: number; state: ProjectKubeProvisioningState }[] = await getApiDatabase()
    .select({
      attempts: projectKubeProvisioning.attempts,
      state: projectKubeProvisioning.state,
    })
    .from(projectKubeProvisioning)
    .where(eq(projectKubeProvisioning.projectId, projectId))
    .limit(1);
  const state: ProjectKubeProvisioningState | undefined = rows[0]?.state;
  if (state?.startsWith('teardown_') !== true) {
    return null;
  }
  return {
    attempts: rows[0]?.attempts ?? 0,
    state: state.slice('teardown_'.length) as ProjectTeardownState,
  };
}

export async function lockProjectTeardownStateWithTransaction(
  transaction: DeploymentTransaction,
  projectId: string,
): Promise<ProjectTeardownObservation | null> {
  const row: typeof projectKubeProvisioning.$inferSelect | undefined = await lockProjectKubeLifecycle(
    transaction,
    projectId,
  );
  if (row?.state.startsWith('teardown_') !== true) {
    return null;
  }
  return {
    attempts: row.attempts,
    state: row.state.slice('teardown_'.length) as ProjectTeardownState,
  };
}

async function lockProjectKubeLifecycle(
  transaction: DeploymentTransaction,
  projectId: string,
): Promise<typeof projectKubeProvisioning.$inferSelect | undefined> {
  const rows: (typeof projectKubeProvisioning.$inferSelect)[] = await transaction
    .select()
    .from(projectKubeProvisioning)
    .where(eq(projectKubeProvisioning.projectId, projectId))
    .limit(1)
    .for('update');
  return rows[0];
}
