import {
  isCustomCertificateDomainHostPlan,
  isCustomHttpDomainHostPlan,
  type DomainHostPlan,
  type SystemDomainPendingStatus,
} from '@compartment/contracts';
import { readApiPublicIngressConfig } from '../config';
import { createDomainOperationUnavailableError, createDomainVersionConflictError } from '../errors/api-business-error';
import {
  completeSystemDomainPendingWithExecutor,
  updateSystemDomainPendingStatusWithExecutor,
} from '../queries/system-domain-operation.query';
import type { SystemDomainPendingStatusUpdateInput } from '../queries/system-domain-operation.query.types';
import type {
  SystemDomainMutationQueryResult,
  SystemDomainSetupStateRow,
  SystemDomainTransaction,
} from '../queries/system-domain.query.types';
import type { DomainCheckResult } from './system-domain-check.service.types';
import { verifySystemDomainDnsProof } from './system-domain-dns-proof.service';
import { synchronizeEdgeAfterDomainActivation } from './system-domain-health.service';
import { runIdempotentSystemDomainMutation } from './system-domain-idempotent-mutation.service';
import { getApiConfig } from '../runtime/runtime-access';
import { synchronizeManagedDomainBrokerAliasAfterDomainActivation } from './system-domain-managed-broker-alias.service';
import { readPendingSystemDomainCertificate } from './system-domain-pending-certificate.service';
import { requirePendingSystemDomainState, type PendingSystemDomainState } from './system-domain-pending-state.service';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';
import { createSystemDomainMutationResult } from './system-domain-status.mapper';
import type { SystemDomainMutationResult, VersionedSystemDomainMutationInput } from './system-domain.service.types';

export async function verifySystemDomainPending(
  input: VersionedSystemDomainMutationInput,
): Promise<SystemDomainMutationResult> {
  return await runIdempotentSystemDomainMutation(
    input.idempotencyKey,
    input,
    async (tx: SystemDomainTransaction): Promise<SystemDomainMutationResult> =>
      await updatePendingVerificationStatus(tx, input),
  );
}

export async function activateSystemDomainPending(
  input: VersionedSystemDomainMutationInput,
): Promise<SystemDomainMutationResult> {
  const result: SystemDomainMutationResult = await runIdempotentSystemDomainMutation(
    input.idempotencyKey,
    input,
    async (tx: SystemDomainTransaction): Promise<SystemDomainMutationResult> =>
      await completeSystemDomainPendingInTransaction(tx, input),
  );

  return await synchronizeEdgeAfterDomainActivation(
    await synchronizeManagedDomainBrokerAliasAfterDomainActivation(result),
  );
}

async function completeSystemDomainPendingInTransaction(
  tx: SystemDomainTransaction,
  input: VersionedSystemDomainMutationInput,
): Promise<SystemDomainMutationResult> {
  const pendingState: PendingSystemDomainState = await readPendingValidatedOperationState(tx);
  const pendingHostPlan: DomainHostPlan = pendingState.hostPlan;
  const pendingOperationId: string = pendingState.operationId;
  assertPendingVerified(pendingState.status);
  await assertPendingDnsProofStillValid(pendingOperationId, pendingHostPlan);

  const mutationResult: SystemDomainMutationQueryResult | null = await completeSystemDomainPendingWithExecutor(tx, {
    expectedSetupVersion: input.expectedSetupVersion,
    operationId: pendingOperationId,
  });
  if (mutationResult === null) {
    throw createDomainVersionConflictError();
  }

  return createSystemDomainMutationResult(mutationResult, readRuntimeDomainHostPlan());
}

async function updatePendingVerificationStatus(
  tx: SystemDomainTransaction,
  input: VersionedSystemDomainMutationInput,
): Promise<SystemDomainMutationResult> {
  const pendingState: PendingSystemDomainState = await readPendingValidatedOperationState(tx);
  const pendingHostPlan: DomainHostPlan = pendingState.hostPlan;
  const pendingOperationId: string = pendingState.operationId;
  assertPendingVerificationReady(pendingState.status, pendingHostPlan);

  const checkResult: DomainCheckResult = await verifySystemDomainDnsProof({
    pendingBaseDomain: pendingHostPlan.baseDomain,
    managedDomainBrokerToken: getApiConfig().managedDomainBrokerToken ?? null,
    pendingOperationId,
    publicIngressConfig: readApiPublicIngressConfig(),
  });
  const mutationResult: SystemDomainMutationQueryResult | null = await updateSystemDomainPendingStatusWithExecutor(
    tx,
    buildPendingStatusUpdateInput(input, pendingOperationId, pendingHostPlan, checkResult),
  );
  if (mutationResult === null) {
    throw createDomainVersionConflictError();
  }

  return createSystemDomainMutationResult(mutationResult, readRuntimeDomainHostPlan());
}

function buildPendingStatusUpdateInput(
  input: VersionedSystemDomainMutationInput,
  pendingOperationId: string,
  hostPlan: DomainHostPlan,
  checkResult: DomainCheckResult,
): SystemDomainPendingStatusUpdateInput {
  return {
    expectedSetupVersion: input.expectedSetupVersion,
    failureCode: checkResult.failure?.code ?? null,
    failureMessage: checkResult.failure?.message ?? null,
    operationId: pendingOperationId,
    pendingStatus: checkResult.failure === null ? 'verified' : readPendingVerificationStep(hostPlan),
  };
}

async function readPendingValidatedOperationState(tx: SystemDomainTransaction): Promise<PendingSystemDomainState> {
  const pendingState: PendingSystemDomainState = await requirePendingSystemDomainState(tx);
  assertPendingSupportedOperation(pendingState.hostPlan);
  await assertPendingCertificateReady(pendingState.setupState, pendingState.hostPlan, pendingState.operationId);

  return pendingState;
}

function assertPendingSupportedOperation(hostPlan: DomainHostPlan): void {
  if (isCustomHttpDomainHostPlan(hostPlan) || isCustomCertificateDomainHostPlan(hostPlan)) {
    return;
  }

  throw createDomainOperationUnavailableError('Only custom domain operations are supported here.');
}

function assertPendingVerified(status: SystemDomainPendingStatus): void {
  if (status !== 'verified') {
    throw createDomainOperationUnavailableError('The pending domain must be verified before activation.');
  }
}

function assertPendingVerificationReady(status: SystemDomainPendingStatus, hostPlan: DomainHostPlan): void {
  const requiredStatus: SystemDomainPendingStatus = readPendingVerificationStep(hostPlan);
  if (status !== requiredStatus && status !== 'verified') {
    throw createDomainOperationUnavailableError(
      `The pending domain must be in ${requiredStatus} or verified before this step.`,
    );
  }
}

async function assertPendingCertificateReady(
  setupState: SystemDomainSetupStateRow,
  hostPlan: DomainHostPlan,
  operationId: string,
): Promise<void> {
  if (!isCustomCertificateDomainHostPlan(hostPlan)) {
    return;
  }
  if (setupState.pendingCertificateMetadataJson === null) {
    throw createDomainOperationUnavailableError('Attach a certificate before verifying this domain.');
  }

  try {
    await readPendingSystemDomainCertificate(operationId, hostPlan);
  } catch (error) {
    throw createDomainOperationUnavailableError((error as Error).message);
  }
}

function readPendingVerificationStep(hostPlan: DomainHostPlan): SystemDomainPendingStatus {
  return isCustomCertificateDomainHostPlan(hostPlan) ? 'pending_cert' : 'pending_dns';
}

async function assertPendingDnsProofStillValid(
  pendingOperationId: string,
  pendingHostPlan: DomainHostPlan,
): Promise<void> {
  const checkResult: DomainCheckResult = await verifySystemDomainDnsProof({
    pendingBaseDomain: pendingHostPlan.baseDomain,
    managedDomainBrokerToken: getApiConfig().managedDomainBrokerToken ?? null,
    pendingOperationId,
    publicIngressConfig: readApiPublicIngressConfig(),
  });
  if (checkResult.failure === null) {
    return;
  }

  throw createDomainOperationUnavailableError(
    `The pending domain must be re-verified before activation. ${checkResult.failure.message}`,
  );
}
