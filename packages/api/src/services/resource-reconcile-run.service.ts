import {
  type ResourceClaimIdentity,
  type ResourceReconcileIntent,
  type WorkerAcknowledgeResourceReconcileRequest,
} from '@compartment/contracts';
import {
  createResourceReconcileRun,
  createResourceReconcileRunWithExecutor,
} from '../queries/resource-reconcile-create.query';
import {
  acknowledgeResourceReconcileRun,
  claimResourceReconcileRun,
  readResourceBootstrapSettlement,
  readResourceReconcileSettlement,
} from '../queries/resource-reconcile-runs.query';
import type {
  ClaimedResourceReconcileRun,
  CreateResourceReconcileRunResult,
  ResourceBootstrapSettlement,
  ResourceReconcileSettlement,
} from '../queries/resource-reconcile-runs.query.types';
import { createProjectArchivedError } from '../errors/api-business-error';
import { archivedResourceRunFailureMessage } from '../queries/resource-reconcile-project.query';
import { projectProvisioningAttemptLimit } from '../queries/project-provisioning-policy';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { waitForResourceReconcile, waitForResourceReconcileSettlement } from './resource-reconcile-wait.service';
import type { ClaimedResourceReconcileResult } from './resource-reconcile-run.service.types';

export { waitForResourceReconcile };

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
  assertExpectedResourceClaims(expectedClaims);
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
  assertExpectedResourceClaims(expectedClaims);
  requireCreatedResourceRun(
    await createResourceReconcileRun({ expectedClaims, intent, operationId, type: 'reconcile' }),
  );
}

export async function waitForResourceBootstrap(projectResourceId: string): Promise<ProjectResourceRow> {
  return await waitForSettledResourceBootstrap(projectResourceId, false);
}

export async function waitForResourceBootstrapForCleanup(projectResourceId: string): Promise<ProjectResourceRow> {
  return await waitForSettledResourceBootstrap(projectResourceId, true);
}

async function waitForSettledResourceBootstrap(
  projectResourceId: string,
  allowTerminalProvisioningFailure: boolean,
): Promise<ProjectResourceRow> {
  for (;;) {
    const settlement: ResourceBootstrapSettlement | null = await readResourceBootstrapSettlement(projectResourceId);
    const resource: ProjectResourceRow | null = readSettledBootstrapResource(
      settlement,
      allowTerminalProvisioningFailure,
    );
    if (resource !== null) {
      return resource;
    }
    const operationId: string = requireSettlementOperationId(settlement);
    if (allowTerminalProvisioningFailure) {
      await waitForResourceReconcileSettlement(operationId);
    } else {
      await waitForResourceReconcile(operationId);
    }
  }
}

export async function waitForResourceRunning(projectResourceId: string): Promise<ProjectResourceRow> {
  for (;;) {
    const settlement: ResourceReconcileSettlement | null = await readResourceReconcileSettlement(projectResourceId);
    const resource: ProjectResourceRow | null = readRunningResource(settlement);
    if (resource !== null) {
      return resource;
    }
    await waitForResourceReconcile(requireSettlementOperationId(settlement));
  }
}

function readRunningResource(settlement: ResourceReconcileSettlement | null): ProjectResourceRow | null {
  if (settlement === null) {
    throw new Error('Resource disappeared while waiting for Kubernetes reconciliation.');
  }
  const { resource, state } = settlement;
  if (state?.phase === 'failed') {
    throw new Error(state.failureMessage ?? 'Kubernetes resource reconcile failed.');
  }
  if (resource.status === 'deleting') {
    throw new Error('Resource was deleted while waiting for Kubernetes reconciliation.');
  }
  if (state?.phase === 'succeeded' && resource.status !== 'running') {
    throw new Error(`Kubernetes resource settled as ${resource.status} while waiting for running.`);
  }
  return resource.status === 'running' && state?.phase === 'succeeded' ? resource : null;
}

function readSettledBootstrapResource(
  settlement: ResourceBootstrapSettlement | null,
  allowTerminalProvisioningFailure: boolean,
): ProjectResourceRow | null {
  if (settlement === null) {
    throw new Error('Resource disappeared while waiting for Kubernetes bootstrap.');
  }
  const { resource, state } = settlement;
  if (resource.expectedClaimsJson !== '[]' || state === null) {
    return resource;
  }
  if (state.phase === 'failed') {
    return readFailedBootstrapSettlement(settlement, allowTerminalProvisioningFailure);
  }
  if (state.phase === 'succeeded') {
    throw new Error('Kubernetes resource bootstrap completed without persistent claim identities.');
  }
  return null;
}

function requireSettlementOperationId(settlement: ResourceReconcileSettlement | null): string {
  const operationId: string | undefined = settlement?.state?.operationId;
  if (operationId === undefined) {
    throw new Error('Kubernetes resource reconcile operation disappeared while waiting for settlement.');
  }
  return operationId;
}

function readFailedBootstrapSettlement(
  settlement: ResourceBootstrapSettlement,
  allowTerminalProvisioningFailure: boolean,
): ProjectResourceRow {
  const { provisioningAttempts, provisioningState, resource, state } = settlement;
  if (
    allowTerminalProvisioningFailure &&
    (isTerminalProvisioningFailure(provisioningAttempts, provisioningState) ||
      state?.failureMessage === archivedResourceRunFailureMessage)
  ) {
    return resource;
  }
  throw new Error(state?.failureMessage ?? 'Kubernetes resource bootstrap failed.');
}

function isTerminalProvisioningFailure(attempts: number, state: string): boolean {
  return ['failed', 'policy-failed'].includes(state) && attempts >= projectProvisioningAttemptLimit;
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

function assertExpectedResourceClaims(expectedClaims: ResourceClaimIdentity[]): void {
  if (expectedClaims.length === 0) {
    throw new Error('Resource reconcile refused: expected PVC identity is missing. Bootstrap is required.');
  }
}

function requireCreatedResourceRun(result: CreateResourceReconcileRunResult): void {
  if (result === 'bootstrap-active') {
    throw new Error('Resource bootstrap is already in progress.');
  }
  if (result === 'project-archived') {
    throw createProjectArchivedError();
  }
  if (result === 'resource-deleting') {
    throw new Error('Resource reconciliation was refused because deletion is in progress.');
  }
}
