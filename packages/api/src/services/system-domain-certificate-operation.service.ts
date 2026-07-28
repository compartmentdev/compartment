import {
  domainCertificateMetadataCoversHostPlan,
  isCustomCertificateDomainHostPlan,
  type DomainHostPlan,
  type SystemDomainCertificate,
  type SystemDomainPendingStatus,
} from '@compartment/contracts';
import { createDomainOperationUnavailableError, createDomainVersionConflictError } from '../errors/api-business-error';
import { attachSystemDomainPendingCertificateWithExecutor } from '../queries/system-domain-operation.query';
import type { SystemDomainPendingCertificateInput } from '../queries/system-domain-operation.query.types';
import type { SystemDomainMutationQueryResult, SystemDomainTransaction } from '../queries/system-domain.query.types';
import { runIdempotentSystemDomainMutation } from './system-domain-idempotent-mutation.service';
import { requirePendingSystemDomainState, type PendingSystemDomainState } from './system-domain-pending-state.service';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';
import { createSystemDomainMutationResult } from './system-domain-status.mapper';
import type { AttachSystemDomainCertificateInput, SystemDomainMutationResult } from './system-domain.service.types';

export async function attachSystemDomainPendingCertificate(
  input: AttachSystemDomainCertificateInput,
): Promise<SystemDomainMutationResult> {
  return await runIdempotentSystemDomainMutation(
    input.idempotencyKey,
    input,
    async (tx: SystemDomainTransaction): Promise<SystemDomainMutationResult> =>
      await attachPendingCertificate(tx, input),
  );
}

async function attachPendingCertificate(
  tx: SystemDomainTransaction,
  input: AttachSystemDomainCertificateInput,
): Promise<SystemDomainMutationResult> {
  const pendingState: PendingSystemDomainState = await requirePendingSystemDomainState(tx);
  const pendingHostPlan: DomainHostPlan = pendingState.hostPlan;
  const pendingOperationId: string = pendingState.operationId;
  assertPendingCustomCertOperation(pendingHostPlan);
  assertPendingCertificateAttachReady(pendingState.status);
  const certificate: SystemDomainCertificate = readValidatedPendingCertificate(input.certificate, pendingHostPlan);

  const mutationResult: SystemDomainMutationQueryResult | null = await attachSystemDomainPendingCertificateWithExecutor(
    tx,
    buildPendingCertificateInput(input, pendingOperationId, certificate),
  );
  if (mutationResult === null) {
    throw createDomainVersionConflictError();
  }

  return createSystemDomainMutationResult(mutationResult, readRuntimeDomainHostPlan());
}

function buildPendingCertificateInput(
  input: AttachSystemDomainCertificateInput,
  pendingOperationId: string,
  certificate: SystemDomainCertificate,
): SystemDomainPendingCertificateInput {
  return {
    expectedSetupVersion: input.expectedSetupVersion,
    operationId: pendingOperationId,
    pendingCertificateMetadataJson: JSON.stringify(certificate.metadata),
    pendingTlsSecretName: certificate.secretName,
  };
}

function assertPendingCustomCertOperation(hostPlan: DomainHostPlan): void {
  if (!isCustomCertificateDomainHostPlan(hostPlan)) {
    throw createDomainOperationUnavailableError('Only custom certificate domain operations can attach certificates.');
  }
}

function assertPendingCertificateAttachReady(status: SystemDomainPendingStatus): void {
  if (status !== 'pending_dns' && status !== 'pending_cert') {
    throw createDomainOperationUnavailableError('The pending domain must be in pending_dns or pending_cert first.');
  }
}

function readValidatedPendingCertificate(
  certificate: SystemDomainCertificate,
  hostPlan: DomainHostPlan,
): SystemDomainCertificate {
  if (!domainCertificateMetadataCoversHostPlan(certificate.metadata, hostPlan)) {
    throw createDomainOperationUnavailableError('The staged TLS Secret certificate does not cover the pending domain.');
  }
  return certificate;
}
