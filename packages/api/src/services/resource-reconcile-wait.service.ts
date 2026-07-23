import { setTimeout as sleep } from 'node:timers/promises';
import { readResourceReconcileRunState } from '../queries/resource-reconcile-runs.query';
import type {
  ResourceReconcileRunState,
  ResourceReconcileRunWaitState,
} from '../queries/resource-reconcile-runs.query.types';
import { readResourceReconcileRunWaitState } from '../queries/resource-reconcile-wait.query';
import {
  resourceProductJobQueueBaseTimeoutMs,
  resourceReconcileOperationWaitTimeoutMs,
  resourceReconcilePredecessorWaitTimeoutMs,
} from '../queries/resource-reconcile-policy';
import type { ResourceReconcileWaitContext } from './resource-reconcile-wait.service.types';

const resourceReconcilePollInitialDelayMs: number = 100;
const resourceReconcilePollMaxDelayMs: number = 5_000;
const resourceReconcileQueueRefreshIntervalMs: number = 30_000;

export async function waitForResourceReconcile(operationId: string): Promise<void> {
  const state: ResourceReconcileRunState = await waitForResourceReconcileSettlement(operationId);
  if (state.phase === 'failed') {
    throw new Error(state.failureMessage ?? 'Kubernetes resource reconcile failed.');
  }
}

export async function waitForResourceReconcileSettlement(operationId: string): Promise<ResourceReconcileRunState> {
  const context: ResourceReconcileWaitContext = await createWaitContext(operationId);
  let pollDelayMs: number = resourceReconcilePollInitialDelayMs;
  for (;;) {
    const settlement: ResourceReconcileRunState | null = await readCurrentSettlement(operationId, context);
    if (settlement !== null) {
      return settlement;
    }
    assertResourceReconcileBeforeDeadline(context.deadlineAt);
    await delayResourceReconcilePoll(pollDelayMs);
    pollDelayMs = nextResourceReconcilePollDelayMs(pollDelayMs);
    context.state = await readResourceReconcileRunState(operationId);
  }
}

async function readCurrentSettlement(
  operationId: string,
  context: ResourceReconcileWaitContext,
): Promise<ResourceReconcileRunState | null> {
  const settlement: ResourceReconcileRunState | null = readResourceReconcileSettlement(context.state);
  if (settlement !== null) {
    return settlement;
  }
  await refreshQueueStateIfDue(operationId, context);
  return readResourceReconcileSettlement(context.state);
}

async function createWaitContext(operationId: string): Promise<ResourceReconcileWaitContext> {
  const state: ResourceReconcileRunWaitState | null = await readResourceReconcileRunWaitState(operationId);
  return {
    deadlineAt: Date.now() + resourceReconcileWaitTimeoutMs(state),
    nextQueueRefreshAt: Date.now() + resourceReconcileQueueRefreshIntervalMs,
    predecessorToken: state?.predecessorToken ?? null,
    state,
  };
}

async function refreshQueueStateIfDue(operationId: string, context: ResourceReconcileWaitContext): Promise<void> {
  if (Date.now() < context.nextQueueRefreshAt && Date.now() < context.deadlineAt) {
    return;
  }
  const state: ResourceReconcileRunWaitState | null = await readResourceReconcileRunWaitState(operationId);
  const predecessorToken: string | null = state?.predecessorToken ?? null;
  if (predecessorToken !== context.predecessorToken) {
    context.deadlineAt = Math.max(context.deadlineAt, Date.now() + resourceReconcileWaitTimeoutMs(state));
    context.predecessorToken = predecessorToken;
  }
  context.nextQueueRefreshAt = Date.now() + resourceReconcileQueueRefreshIntervalMs;
  context.state = state;
}

function readResourceReconcileSettlement(state: ResourceReconcileRunState | null): ResourceReconcileRunState | null {
  return state?.phase === 'failed' || state?.phase === 'succeeded' ? state : null;
}

function assertResourceReconcileBeforeDeadline(deadlineAt: number): void {
  if (Date.now() >= deadlineAt) {
    throw new Error('Timed out waiting for Kubernetes resource reconcile.');
  }
}

function resourceReconcileWaitTimeoutMs(state: ResourceReconcileRunWaitState | null): number {
  const resourcePredecessorBudgetMs: number =
    (state?.predecessorCount ?? 0) * resourceReconcilePredecessorWaitTimeoutMs();
  const productJobPredecessorBudgetMs: number =
    (state?.predecessorProductJobCount ?? 0) * resourceProductJobQueueBaseTimeoutMs +
    (state?.predecessorProductJobTimeoutMs ?? 0);
  return (
    resourcePredecessorBudgetMs +
    productJobPredecessorBudgetMs +
    resourceReconcileOperationWaitTimeoutMs(state?.operationType ?? 'reconcile')
  );
}

function nextResourceReconcilePollDelayMs(currentDelayMs: number): number {
  return Math.min(currentDelayMs * 2, resourceReconcilePollMaxDelayMs);
}

async function delayResourceReconcilePoll(delayMs: number): Promise<void> {
  await sleep(delayMs);
}
