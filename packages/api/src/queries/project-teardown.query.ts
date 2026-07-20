import { eq } from 'drizzle-orm';
import { projectKubeProvisioning } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentTransaction } from './deployments.query.types';
import { projectProvisioningAttemptLimit } from './project-provisioning-policy';
import type { ProjectKubeProvisioningState, ProjectTeardownState } from './project-provisioning.query.types';

export async function requestProjectTeardown(projectId: string): Promise<void> {
  await getApiDatabase().transaction(
    async (transaction: DeploymentTransaction): Promise<void> =>
      await requestProjectTeardownWithTransaction(transaction, projectId),
  );
}

async function requestProjectTeardownWithTransaction(
  transaction: DeploymentTransaction,
  projectId: string,
): Promise<void> {
  const row: typeof projectKubeProvisioning.$inferSelect | undefined = await lockProjectKubeLifecycle(
    transaction,
    projectId,
  );
  if (row === undefined) {
    throw new Error('Project Kubernetes lifecycle state not found.');
  }
  if (!teardownAlreadyRequested(row.state, row.attempts)) {
    await resetProjectTeardown(transaction, projectId);
  }
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

async function resetProjectTeardown(transaction: DeploymentTransaction, projectId: string): Promise<void> {
  await transaction
    .update(projectKubeProvisioning)
    .set({
      attempts: 0,
      failureMessage: null,
      leaseExpiresAt: null,
      leaseId: null,
      state: 'teardown_pending',
      updatedAt: new Date(),
    })
    .where(eq(projectKubeProvisioning.projectId, projectId));
}

function teardownAlreadyRequested(state: ProjectKubeProvisioningState, attempts: number): boolean {
  return (
    state === 'teardown_pending' ||
    state === 'teardown_running' ||
    state === 'teardown_succeeded' ||
    (state === 'teardown_failed' && attempts < projectProvisioningAttemptLimit)
  );
}

export async function readProjectTeardownState(projectId: string): Promise<ProjectTeardownState | null> {
  const rows: { state: ProjectKubeProvisioningState }[] = await getApiDatabase()
    .select({ state: projectKubeProvisioning.state })
    .from(projectKubeProvisioning)
    .where(eq(projectKubeProvisioning.projectId, projectId))
    .limit(1);
  const state: ProjectKubeProvisioningState | undefined = rows[0]?.state;
  if (state?.startsWith('teardown_') !== true) {
    return null;
  }
  return state.slice('teardown_'.length) as ProjectTeardownState;
}
