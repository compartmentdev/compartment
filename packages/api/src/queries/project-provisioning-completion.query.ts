import { and, eq, gt, or, type SQL } from 'drizzle-orm';
import type { ProjectProvisioningAction } from '@compartment/contracts';
import { projectKubeProvisioning } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { DeploymentTransaction } from './deployments.query.types';
import {
  projectProvisioningAttemptLimit,
  projectIsolationVersion,
  projectProvisioningLeaseDuration,
  projectProvisioningTerminalFailure,
  projectTeardownTerminalFailure,
} from './project-provisioning-policy';
import { failTerminalProjectProvisioning } from './project-provisioning-terminal.query';
import type {
  CompleteProjectProvisioningInput,
  ProjectProvisioningCompletionStatus,
} from './project-provisioning.query.types';
import { deleteArchivedProjectWithExecutor } from './projects.query';
import { clearDisconnectedBindingProjectReferences } from './source.query';

interface CompletedProjectProvisioningRow {
  attempts: number;
  projectId: string;
}

export async function completeProjectProvisioning(input: CompleteProjectProvisioningInput): Promise<boolean> {
  if (input.isolationVersion !== projectIsolationVersion) {
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
  await applyProjectProvisioningCompletion(transaction, input, completed);
  return true;
}

async function applyProjectProvisioningCompletion(
  transaction: DeploymentTransaction,
  input: CompleteProjectProvisioningInput,
  completed: CompletedProjectProvisioningRow,
): Promise<void> {
  if (shouldFailTerminalProvisioning(input, completed)) {
    await failTerminalProjectProvisioning(
      transaction,
      completed.projectId,
      projectProvisioningTerminalFailure(input.failureMessage),
      new Date(),
    );
  }
  if (shouldFailTerminalTeardown(input, completed)) {
    await failTerminalProjectTeardown(transaction, completed, input.failureMessage);
  }
  if (input.action === 'teardown' && input.status === 'succeeded') {
    await finalizeProjectTeardown(transaction, completed.projectId);
  }
}

function shouldFailTerminalProvisioning(
  input: CompleteProjectProvisioningInput,
  completed: CompletedProjectProvisioningRow,
): boolean {
  return (
    input.action === 'provision' && input.status === 'failed' && completed.attempts >= projectProvisioningAttemptLimit
  );
}

function shouldFailTerminalTeardown(
  input: CompleteProjectProvisioningInput,
  completed: CompletedProjectProvisioningRow,
): boolean {
  return (
    input.action === 'teardown' && input.status === 'failed' && completed.attempts >= projectProvisioningAttemptLimit
  );
}

async function failTerminalProjectTeardown(
  transaction: DeploymentTransaction,
  completed: CompletedProjectProvisioningRow,
  failureMessage: string | null,
): Promise<void> {
  await transaction
    .update(projectKubeProvisioning)
    .set({ failureMessage: projectTeardownTerminalFailure(failureMessage) })
    .where(eq(projectKubeProvisioning.projectId, completed.projectId));
}

async function finalizeProjectTeardown(transaction: DeploymentTransaction, projectId: string): Promise<void> {
  // Delete eligibility is validated transactionally before teardown; completion commits only its async runtime outcome.
  const finalizedAt: Date = new Date();
  await clearDisconnectedBindingProjectReferences(transaction, projectId, finalizedAt);
  await deleteArchivedProjectWithExecutor(transaction, projectId);
}

async function renewProjectProvisioningLease(
  transaction: DeploymentTransaction,
  input: CompleteProjectProvisioningInput,
  now: Date,
): Promise<boolean> {
  const rows: { projectId: string }[] = await transaction
    .update(projectKubeProvisioning)
    .set({
      leaseExpiresAt: new Date(now.getTime() + projectProvisioningLeaseDuration(input.action)),
      updatedAt: now,
    })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, input.projectId),
        eq(projectKubeProvisioning.leaseId, input.leaseId),
        eq(projectKubeProvisioning.state, runningState(input.action)),
        gt(projectKubeProvisioning.leaseExpiresAt, now),
        provisioningVersionCondition(input),
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
      isolationVersion: completionIsolationVersion(input),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectKubeProvisioning.projectId, input.projectId),
        eq(projectKubeProvisioning.leaseId, input.leaseId),
        eq(projectKubeProvisioning.state, runningState(input.action)),
        provisioningVersionCondition(input),
      ),
    )
    .returning({ attempts: projectKubeProvisioning.attempts, projectId: projectKubeProvisioning.projectId });
  return rows[0];
}

function provisioningVersionCondition(input: CompleteProjectProvisioningInput): SQL | undefined {
  return input.action === 'teardown'
    ? undefined
    : or(
        eq(projectKubeProvisioning.isolationVersion, input.isolationVersion - 1),
        eq(projectKubeProvisioning.isolationVersion, input.isolationVersion),
      );
}

function completionIsolationVersion(
  input: CompleteProjectProvisioningInput,
): number | typeof projectKubeProvisioning.isolationVersion {
  return input.action === 'provision' && input.status === 'succeeded'
    ? input.isolationVersion
    : projectKubeProvisioning.isolationVersion;
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
