import { randomUUID } from 'node:crypto';
import type { ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';
import { and, eq, ne } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { projectResources, resourceReconcileRuns } from '../db/schema';
import type { AcknowledgeResourceReconcileRunInput } from './resource-reconcile-runs.query.types';
import { nextResourceReconcileCreatedAt } from './resource-reconcile-create.query';

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
  const [resource] = await transaction
    .update(projectResources)
    .set({ expectedClaimsJson: JSON.stringify(expectedClaims), updatedAt: new Date() })
    .where(eq(projectResources.id, run.projectResourceId))
    .returning({ status: projectResources.status });
  if (!projectArchived && resource !== undefined && resource.status !== 'deleting') {
    const intent: ResourceReconcileIntent = JSON.parse(run.intentJson) as ResourceReconcileIntent;
    const createdAt: Date = await nextResourceReconcileCreatedAt(transaction, run.projectResourceId);
    await transaction.insert(resourceReconcileRuns).values({
      createdAt,
      expectedClaimsJson: JSON.stringify(expectedClaims),
      id: `resource_operation_${randomUUID().replaceAll('-', '')}`,
      intentJson: JSON.stringify({ ...intent, replicas: resource.status === 'stopped' ? 0 : intent.replicas }),
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
    .where(and(eq(projectResources.id, run.projectResourceId), ne(projectResources.status, 'deleting')));
}
