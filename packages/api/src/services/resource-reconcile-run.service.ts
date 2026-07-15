import { setTimeout as delay } from 'node:timers/promises';
import type {
  ResourceClaimIdentity,
  ResourceReconcileIntent,
  WorkerAcknowledgeResourceReconcileRequest,
} from '@compartment/contracts';
import {
  createResourceReconcileRun,
  createResourceReconcileRunWithExecutor,
} from '../queries/resource-reconcile-create.query';
import {
  acknowledgeResourceReconcileRun,
  claimResourceReconcileRun,
  readResourceReconcileRunState,
} from '../queries/resource-reconcile-runs.query';
import type {
  ClaimedResourceReconcileRun,
  CreateResourceReconcileRunResult,
  ResourceReconcileRunState,
} from '../queries/resource-reconcile-runs.query.types';
import { createProjectArchivedError } from '../errors/api-business-error';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import type { ClaimedResourceReconcileResult } from './resource-reconcile-run.service.types';

export async function requestResourceBootstrap(operationId: string, intent: ResourceReconcileIntent): Promise<void> {
  requireCreatedResourceRun(
    await createResourceReconcileRun({ expectedClaims: [], intent, operationId, type: 'bootstrap' }),
  );
}

export async function requestResourceReconcileWithExecutor(
  tx: ResourceTransaction,
  operationId: string,
  intent: ResourceReconcileIntent,
  resource: ProjectResourceRow,
): Promise<void> {
  const expectedClaims: ResourceClaimIdentity[] = readExpectedResourceClaims(resource);
  assertExpectedResourceClaims(intent, expectedClaims);
  requireCreatedResourceRun(
    await createResourceReconcileRunWithExecutor(tx, { expectedClaims, intent, operationId, type: 'reconcile' }),
  );
}

export async function requestResourceReconcile(
  operationId: string,
  intent: ResourceReconcileIntent,
  resource: ProjectResourceRow,
): Promise<void> {
  const expectedClaims: ResourceClaimIdentity[] = readExpectedResourceClaims(resource);
  assertExpectedResourceClaims(intent, expectedClaims);
  requireCreatedResourceRun(
    await createResourceReconcileRun({ expectedClaims, intent, operationId, type: 'reconcile' }),
  );
}

export async function waitForResourceReconcile(operationId: string): Promise<void> {
  const deadlineAt: number = Date.now() + 120_000;
  while (Date.now() < deadlineAt) {
    const state: ResourceReconcileRunState | null = await readResourceReconcileRunState(operationId);
    if (state?.phase === 'succeeded') {
      return;
    }
    if (state?.phase === 'failed') {
      throw new Error(state.failureMessage ?? 'Kubernetes resource reconcile failed.');
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for Kubernetes resource reconcile.');
}

export async function claimNextResourceReconcile(): Promise<ClaimedResourceReconcileResult> {
  const claimed: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
  return (
    claimed ?? {
      expectedClaims: [],
      intent: null,
      leaseId: null,
      operationId: null,
      previousManifestJson: null,
      type: null,
    }
  );
}

export async function acknowledgeResourceReconcile(input: WorkerAcknowledgeResourceReconcileRequest): Promise<void> {
  await acknowledgeResourceReconcileRun(input);
}

function readExpectedResourceClaims(resource: ProjectResourceRow): ResourceClaimIdentity[] {
  return JSON.parse(resource.expectedClaimsJson) as ResourceClaimIdentity[];
}

function assertExpectedResourceClaims(intent: ResourceReconcileIntent, expectedClaims: ResourceClaimIdentity[]): void {
  if (intent.volumes.length > 0 && expectedClaims.length === 0) {
    throw new Error('Resource reconcile refused: expected PVC identity is missing. Bootstrap is required.');
  }
}

function requireCreatedResourceRun(result: CreateResourceReconcileRunResult): void {
  if (result === 'project-archived') {
    throw createProjectArchivedError();
  }
}
