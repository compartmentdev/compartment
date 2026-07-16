import type { WorkerPersistProductJobResultRequest } from '@compartment/contracts';
import { expireProductJobWait, readProductJobQueueWaitState } from '../queries/product-job-wait.query';
import type { ProductJobQueueWaitState } from '../queries/product-job-wait.query.types';
import { readProductJobResult } from '../queries/product-job-runs.query';
import { resourceProductJobQueueBaseTimeoutMs } from '../queries/resource-reconcile-policy';
import type { ResourceProductJobWaitContext } from './resource-product-job-wait.service.types';

const productJobPollIntervalMs: number = 100;
const productJobPollMaxIntervalMs: number = 5_000;
const productJobQueueRefreshIntervalMs: number = 30_000;

export async function waitForResourceOperationProductJob(
  operationId: string,
): Promise<WorkerPersistProductJobResultRequest> {
  const context: ResourceProductJobWaitContext = await createProductJobWaitContext(operationId);
  let pollIntervalMs: number = productJobPollIntervalMs;
  for (;;) {
    const result: WorkerPersistProductJobResultRequest | null = await readProductJobOrExpire(operationId, context);
    if (result !== null) {
      return result;
    }
    await delayProductJobPoll(pollIntervalMs);
    pollIntervalMs = Math.min(pollIntervalMs * 2, productJobPollMaxIntervalMs);
  }
}

async function createProductJobWaitContext(operationId: string): Promise<ResourceProductJobWaitContext> {
  const state: ProductJobQueueWaitState | null = await readProductJobQueueWaitState('resource-operation', operationId);
  if (state === null) {
    throw new Error(`Kubernetes resource operation ${operationId} disappeared before queue settlement.`);
  }
  return {
    deadlineAt: nextProductJobDeadline(state.queueBudgetMs),
    nextQueueRefreshAt: Date.now() + productJobQueueRefreshIntervalMs,
    predecessorToken: state.predecessorToken,
  };
}

async function readProductJobOrExpire(
  operationId: string,
  context: ResourceProductJobWaitContext,
): Promise<WorkerPersistProductJobResultRequest | null> {
  const result: WorkerPersistProductJobResultRequest | null = await readProductJobResult(
    'resource-operation',
    operationId,
  );
  if (result !== null) {
    return result;
  }
  await refreshProductJobQueueIfDue(operationId, context);
  if (Date.now() < context.deadlineAt) {
    return null;
  }
  return await expireQueuedResourceOperation(operationId);
}

async function refreshProductJobQueueIfDue(operationId: string, context: ResourceProductJobWaitContext): Promise<void> {
  if (Date.now() < context.nextQueueRefreshAt && Date.now() < context.deadlineAt) {
    return;
  }
  const state: ProductJobQueueWaitState | null = await readProductJobQueueWaitState('resource-operation', operationId);
  if (state === null) {
    throw new Error(`Kubernetes resource operation ${operationId} disappeared while waiting for queue settlement.`);
  }
  if (state.predecessorToken !== context.predecessorToken) {
    context.deadlineAt = Math.max(context.deadlineAt, nextProductJobDeadline(state.queueBudgetMs));
    context.predecessorToken = state.predecessorToken;
  }
  context.nextQueueRefreshAt = Date.now() + productJobQueueRefreshIntervalMs;
}

function nextProductJobDeadline(queueBudgetMs: number): number {
  return Date.now() + resourceProductJobQueueBaseTimeoutMs + queueBudgetMs;
}

async function expireQueuedResourceOperation(operationId: string): Promise<WorkerPersistProductJobResultRequest> {
  return await expireProductJobWait({
    completedAt: new Date().toISOString(),
    exitCode: null,
    identityId: operationId,
    jobClass: 'resource-operation',
    jobName: `queue-timeout/${operationId}`,
    logs: 'Timed out waiting for queued Kubernetes resource operation.',
    podName: null,
    status: 'timed-out',
  });
}

async function delayProductJobPoll(delayMs: number): Promise<void> {
  await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, delayMs));
}
