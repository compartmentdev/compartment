import type { ApiDatabaseTransaction } from '../db/client.types';
import { resourceReconcileRuns } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import {
  lockTerminalProvisioningForResource,
  propagateTerminalProvisioningRow,
} from './project-provisioning-terminal.query';
import type { TerminalProvisioningRow } from './project-provisioning-terminal.query.types';
import type { CreateResourceReconcileRunInput } from './resource-reconcile-runs.query.types';

export async function createResourceReconcileRun(input: CreateResourceReconcileRunInput): Promise<void> {
  await getApiDatabase().transaction(
    async (tx: ApiDatabaseTransaction): Promise<void> => await createResourceReconcileRunWithExecutor(tx, input),
  );
}

export async function createResourceReconcileRunWithExecutor(
  executor: ApiDatabaseTransaction,
  input: CreateResourceReconcileRunInput,
): Promise<void> {
  const createdAt: Date = new Date();
  const terminal: TerminalProvisioningRow | undefined = await lockTerminalProvisioningForResource(
    executor,
    input.intent.resourceId,
  );
  await executor.insert(resourceReconcileRuns).values({
    expectedClaimsJson: JSON.stringify(input.expectedClaims),
    id: input.operationId,
    intentJson: JSON.stringify(input.intent),
    operationType: input.type,
    phase: input.type === 'bootstrap' ? 'bootstrap-pending' : 'reconcile-pending',
    projectResourceId: input.intent.resourceId,
  });
  await propagateTerminalProvisioningRow(executor, terminal, createdAt);
}
