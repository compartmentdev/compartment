import type { ApiDatabaseTransaction } from '../db/client.types';
import { resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  lockTerminalProvisioningForResource,
  propagateTerminalProvisioningRow,
} from './project-provisioning-terminal.query';
import type { TerminalProvisioningRow } from './project-provisioning-terminal.query.types';
import { lockResourceReconcileProject } from './resource-reconcile-project.query';
import type {
  CreateResourceReconcileRunInput,
  CreateResourceReconcileRunResult,
  ResourceReconcileProjectLockRow,
} from './resource-reconcile-runs.query.types';

export async function createResourceReconcileRun(
  input: CreateResourceReconcileRunInput,
): Promise<CreateResourceReconcileRunResult> {
  return await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<CreateResourceReconcileRunResult> =>
      await createResourceReconcileRunWithExecutor(tx, input),
  );
}

export async function createResourceReconcileRunWithExecutor(
  executor: ApiDatabaseTransaction,
  input: CreateResourceReconcileRunInput,
): Promise<CreateResourceReconcileRunResult> {
  const createdAt: Date = new Date();
  const terminal: TerminalProvisioningRow | undefined = await lockTerminalProvisioningForResource(
    executor,
    input.intent.resourceId,
  );
  const project: ResourceReconcileProjectLockRow = await lockResourceReconcileProject(
    executor,
    input.intent.resourceId,
  );
  if (project.archivedAt !== null && !isArchivedProjectCleanup(input)) {
    return 'project-archived';
  }
  await insertResourceReconcileRun(executor, input);
  await propagateTerminalProvisioningRow(executor, terminal, createdAt);
  return 'created';
}

async function insertResourceReconcileRun(
  executor: ApiDatabaseTransaction,
  input: CreateResourceReconcileRunInput,
): Promise<void> {
  await executor.insert(resourceReconcileRuns).values({
    expectedClaimsJson: JSON.stringify(input.expectedClaims),
    id: input.operationId,
    intentJson: JSON.stringify(input.intent),
    operationType: input.type,
    phase: input.type === 'bootstrap' ? 'bootstrap-pending' : 'reconcile-pending',
    projectResourceId: input.intent.resourceId,
  });
}

function isArchivedProjectCleanup(input: CreateResourceReconcileRunInput): boolean {
  return input.type === 'reconcile' && input.intent.replicas === 0;
}
