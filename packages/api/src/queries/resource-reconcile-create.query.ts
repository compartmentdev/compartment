import type { ResourceReconcileIntent } from '@compartment/contracts';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { projectResources, resourceReconcileRuns } from '../db/schema';
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
  ResourceReconcileCreatedAtRow,
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
  const resourceId: string = input.intent.resourceId;
  const terminal: TerminalProvisioningRow | undefined = await lockTerminalProvisioningForResource(executor, resourceId);
  const project: ResourceReconcileProjectLockRow = await lockResourceReconcileProject(executor, resourceId);
  const refusal: CreateResourceReconcileRunResult | null = await readResourceReconcileCreationRefusal(
    executor,
    input,
    project,
  );
  if (refusal !== null) {
    return refusal;
  }
  const createdAt: Date = await nextResourceReconcileCreatedAt(executor, resourceId);
  await insertResourceReconcileRun(executor, input, createdAt);
  await markResourceBootstrapStarting(executor, input);
  await propagateTerminalProvisioningRow(executor, terminal, createdAt);
  return 'created';
}

async function readResourceReconcileCreationRefusal(
  executor: ApiDatabaseTransaction,
  input: CreateResourceReconcileRunInput,
  project: ResourceReconcileProjectLockRow,
): Promise<CreateResourceReconcileRunResult | null> {
  if (project.archivedAt !== null && !isArchivedProjectCleanup(input)) {
    return 'project-archived';
  }
  if (project.resourceStatus === 'deleting') {
    const deletionAllowed: boolean =
      isResourceDeletion(input) &&
      !(await hasBlockingResourceDeletion(executor, input.intent.resourceId, input.intent.deleteData));
    if (!deletionAllowed) {
      return 'resource-deleting';
    }
  }
  if (input.type === 'bootstrap' && (await hasActiveResourceBootstrap(executor, input.intent.resourceId))) {
    return 'bootstrap-active';
  }
  return null;
}

async function hasActiveResourceBootstrap(executor: ApiDatabaseTransaction, resourceId: string): Promise<boolean> {
  const [active] = await executor
    .select({ id: resourceReconcileRuns.id })
    .from(resourceReconcileRuns)
    .where(
      and(
        eq(resourceReconcileRuns.projectResourceId, resourceId),
        eq(resourceReconcileRuns.operationType, 'bootstrap'),
        inArray(resourceReconcileRuns.phase, ['bootstrap-pending', 'running']),
      ),
    )
    .limit(1);
  return active !== undefined;
}

async function hasBlockingResourceDeletion(
  executor: ApiDatabaseTransaction,
  resourceId: string,
  deleteData: boolean,
): Promise<boolean> {
  const [active] = await executor
    .select({ id: resourceReconcileRuns.id })
    .from(resourceReconcileRuns)
    .where(
      and(
        eq(resourceReconcileRuns.projectResourceId, resourceId),
        eq(resourceReconcileRuns.operationType, 'reconcile'),
        blockingResourceDeletionCondition(deleteData),
        sql`${resourceReconcileRuns.intentJson}::jsonb ->> 'operation' = 'delete'`,
      ),
    )
    .limit(1);
  return active !== undefined;
}

function blockingResourceDeletionCondition(deleteData: boolean): SQL | undefined {
  return or(
    inArray(resourceReconcileRuns.phase, ['reconcile-pending', 'running']),
    and(
      eq(resourceReconcileRuns.phase, 'succeeded'),
      deleteData ? sql`(${resourceReconcileRuns.intentJson}::jsonb ->> 'deleteData')::boolean` : sql`true`,
    ),
  );
}

async function markResourceBootstrapStarting(
  executor: ApiDatabaseTransaction,
  input: CreateResourceReconcileRunInput,
): Promise<void> {
  if (input.type !== 'bootstrap') {
    return;
  }
  await executor
    .update(projectResources)
    .set({ status: 'starting', updatedAt: new Date() })
    .where(eq(projectResources.id, input.intent.resourceId));
}

export async function updateActiveResourceBootstrapIntent(
  executor: ApiDatabaseTransaction,
  intent: ResourceReconcileIntent,
): Promise<void> {
  await executor
    .update(resourceReconcileRuns)
    .set({ intentJson: JSON.stringify(intent), updatedAt: new Date() })
    .where(
      and(
        eq(resourceReconcileRuns.projectResourceId, intent.resourceId),
        eq(resourceReconcileRuns.operationType, 'bootstrap'),
        inArray(resourceReconcileRuns.phase, ['bootstrap-pending', 'running']),
      ),
    );
}

async function insertResourceReconcileRun(
  executor: ApiDatabaseTransaction,
  input: CreateResourceReconcileRunInput,
  createdAt: Date,
): Promise<void> {
  await executor.insert(resourceReconcileRuns).values({
    createdAt,
    expectedClaimsJson: JSON.stringify(input.expectedClaims),
    id: input.operationId,
    intentJson: JSON.stringify(input.intent),
    operationType: input.type,
    phase: input.type === 'bootstrap' ? 'bootstrap-pending' : 'reconcile-pending',
    projectResourceId: input.intent.resourceId,
  });
}

export async function nextResourceReconcileCreatedAt(
  executor: ApiDatabaseTransaction,
  resourceId: string,
): Promise<Date> {
  const [latest]: ResourceReconcileCreatedAtRow[] = await executor
    .select({ createdAt: resourceReconcileRuns.createdAt })
    .from(resourceReconcileRuns)
    .where(eq(resourceReconcileRuns.projectResourceId, resourceId))
    .orderBy(desc(resourceReconcileRuns.createdAt), desc(resourceReconcileRuns.id))
    .limit(1);
  return new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
}

function isArchivedProjectCleanup(input: CreateResourceReconcileRunInput): boolean {
  return input.type === 'reconcile' && input.intent.replicas === 0;
}

function isResourceDeletion(input: CreateResourceReconcileRunInput): boolean {
  return input.type === 'reconcile' && input.intent.operation === 'delete';
}
