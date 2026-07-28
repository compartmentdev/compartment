import type {
  WorkerCompleteCustomDomainReconcileRequest,
  WorkerFailCustomDomainReconcileRequest,
  WorkerObserveCustomDomainReconcileRequest,
} from '@compartment/contracts';
import {
  activateCustomDomainReconcileRow,
  claimCustomDomainReconcileRow,
  enableCustomDomainEdgeRouting,
  failCustomDomainReconcileRow,
  observeCustomDomainReconcileRow,
  readCustomDomainReconcileLease,
  settleDeletedCustomDomain,
} from '../queries/custom-domain-reconcile.query';
import type {
  ClaimedCustomDomainReconcileRow,
  CustomDomainReconcileLeaseRow,
} from '../queries/custom-domain-reconcile.query.types';
import { synchronizeEdgeAppAccessState } from './app-access-edge.service';
import type {
  CustomDomainReconcileClaimResult,
  CustomDomainReconcileMutationResult,
} from './custom-domain-reconcile.service.types';

export async function claimNextCustomDomainReconcile(): Promise<CustomDomainReconcileClaimResult> {
  const claimed: ClaimedCustomDomainReconcileRow | null = await claimCustomDomainReconcileRow();
  if (claimed === null) {
    return { leaseId: null, target: null };
  }
  return {
    leaseId: claimed.leaseId,
    target: {
      desiredGeneration: claimed.desiredGeneration,
      domainId: claimed.domainId,
      host: claimed.host,
      operation: claimed.operation,
    },
  };
}

export async function observeCustomDomainReconcile(
  input: WorkerObserveCustomDomainReconcileRequest,
): Promise<CustomDomainReconcileMutationResult> {
  return { applied: await observeCustomDomainReconcileRow(input) };
}

export async function completeCustomDomainReconcile(
  input: WorkerCompleteCustomDomainReconcileRequest,
): Promise<CustomDomainReconcileMutationResult> {
  const row: CustomDomainReconcileLeaseRow | undefined = await readCustomDomainReconcileLease(
    input.leaseId,
    input.observedGeneration,
  );
  if (row === undefined) {
    return { applied: false };
  }
  if (row.operation === 'delete') {
    return await completeCustomDomainDeletion(input, row);
  }
  return await completeCustomDomainActivation(input, row);
}

async function completeCustomDomainDeletion(
  input: WorkerCompleteCustomDomainReconcileRequest,
  row: CustomDomainReconcileLeaseRow,
): Promise<CustomDomainReconcileMutationResult> {
  const absent: boolean = !row.observedIngressPresent && !row.observedCertificatePresent;
  return { applied: absent && (await settleDeletedCustomDomain(input.leaseId, input.observedGeneration)) };
}

async function completeCustomDomainActivation(
  input: WorkerCompleteCustomDomainReconcileRequest,
  row: CustomDomainReconcileLeaseRow,
): Promise<CustomDomainReconcileMutationResult> {
  if (!row.observedIngressPresent || !row.observedCertificatePresent || !row.observedCertificateReady) {
    return { applied: false };
  }
  const enabled: boolean = await enableCustomDomainEdgeRouting(input.leaseId, input.observedGeneration);
  if (!enabled) {
    return { applied: false };
  }
  await synchronizeEdgeAppAccessState();
  return {
    applied: await activateCustomDomainReconcileRow(input.leaseId, input.observedGeneration),
  };
}

export async function failCustomDomainReconcile(
  input: WorkerFailCustomDomainReconcileRequest,
): Promise<CustomDomainReconcileMutationResult> {
  return { applied: await failCustomDomainReconcileRow(input) };
}
