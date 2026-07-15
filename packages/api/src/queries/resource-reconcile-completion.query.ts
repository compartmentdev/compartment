import { randomUUID } from 'node:crypto';
import type { ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';
import { eq } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { projectResources, resourceReconcileRuns } from '../db/schema';
import type { AcknowledgeResourceReconcileRunInput } from './resource-reconcile-runs.query.types';

type PersistedResourceReconcileRun = typeof resourceReconcileRuns.$inferSelect;

export async function persistCompletedResourceState(
  transaction: ApiDatabaseTransaction,
  run: PersistedResourceReconcileRun,
  input: AcknowledgeResourceReconcileRunInput,
  projectArchived: boolean,
): Promise<void> {
  if (run.operationType === 'bootstrap' && input.status === 'succeeded' && input.expectedClaims !== undefined) {
    await persistBootstrapCompletion(transaction, run, input.expectedClaims, projectArchived);
  }
  if (run.operationType === 'reconcile' && input.status === 'succeeded') {
    await persistReconcileCompletion(transaction, run);
  }
}

async function persistBootstrapCompletion(
  transaction: ApiDatabaseTransaction,
  run: PersistedResourceReconcileRun,
  expectedClaims: ResourceClaimIdentity[],
  projectArchived: boolean,
): Promise<void> {
  await transaction
    .update(projectResources)
    .set({ expectedClaimsJson: JSON.stringify(expectedClaims), updatedAt: new Date() })
    .where(eq(projectResources.id, run.projectResourceId));
  if (!projectArchived) {
    await transaction.insert(resourceReconcileRuns).values({
      expectedClaimsJson: JSON.stringify(expectedClaims),
      id: `resource_operation_${randomUUID().replaceAll('-', '')}`,
      intentJson: run.intentJson,
      operationType: 'reconcile',
      phase: 'reconcile-pending',
      projectResourceId: run.projectResourceId,
    });
  }
}

async function persistReconcileCompletion(
  transaction: ApiDatabaseTransaction,
  run: PersistedResourceReconcileRun,
): Promise<void> {
  const intent: ResourceReconcileIntent = JSON.parse(run.intentJson) as ResourceReconcileIntent;
  await transaction
    .update(projectResources)
    .set({ status: intent.replicas === 0 ? 'stopped' : 'running', updatedAt: new Date() })
    .where(eq(projectResources.id, run.projectResourceId));
}
