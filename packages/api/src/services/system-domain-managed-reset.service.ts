import type { DomainHostPlan } from '@compartment/contracts';
import { createDomainOperationUnavailableError, createDomainVersionConflictError } from '../errors/api-business-error';
import {
  clearSystemDomainPendingWithExecutor,
  findSystemDomainSetupStateWithExecutor,
} from '../queries/system-domain.query';
import type {
  SystemDomainMutationQueryResult,
  SystemDomainSetupStateRow,
  SystemDomainTransaction,
} from '../queries/system-domain.query.types';
import { synchronizeEdgeAfterDomainActivation } from './system-domain-health.service';
import { runIdempotentSystemDomainMutation } from './system-domain-idempotent-mutation.service';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';
import {
  createSystemDomainMutationResult,
  createUnknownSystemDomainHealth,
  mapSystemDomainStatus,
} from './system-domain-status.mapper';
import type {
  SystemDomainMutationResult,
  SystemDomainStatusResult,
  VersionedSystemDomainMutationInput,
} from './system-domain.service.types';

const managedResetOperationId: string = 'domain-managed-reset';

export async function resetSystemDomainManaged(
  input: VersionedSystemDomainMutationInput,
): Promise<SystemDomainMutationResult> {
  const result: SystemDomainMutationResult = await runIdempotentSystemDomainMutation(
    input.idempotencyKey,
    input,
    async (tx: SystemDomainTransaction): Promise<SystemDomainMutationResult> =>
      await resetSystemDomainManagedInTransaction(tx, input),
  );

  return await synchronizeEdgeAfterDomainActivation(result);
}

async function resetSystemDomainManagedInTransaction(
  tx: SystemDomainTransaction,
  input: VersionedSystemDomainMutationInput,
): Promise<SystemDomainMutationResult> {
  const activeHostPlan: DomainHostPlan = readRuntimeDomainHostPlan();
  assertActiveManagedHostPlan(activeHostPlan);
  const currentSetupState: SystemDomainSetupStateRow | undefined = await findSystemDomainSetupStateWithExecutor(tx);
  if (currentSetupState === undefined) {
    return createMissingSetupStateResetResult(input, activeHostPlan);
  }

  if (currentSetupState.pendingStatus === null) {
    return createNoPendingResetResult(input, activeHostPlan, currentSetupState);
  }

  const mutationResult: SystemDomainMutationQueryResult | null = await clearSystemDomainPendingWithExecutor(tx, {
    expectedSetupVersion: input.expectedSetupVersion,
    operationId: readRequiredPendingOperationId(currentSetupState),
  });
  if (mutationResult === null) {
    throw createDomainVersionConflictError();
  }

  return createSystemDomainMutationResult(mutationResult, activeHostPlan);
}

function createMissingSetupStateResetResult(
  input: VersionedSystemDomainMutationInput,
  activeHostPlan: DomainHostPlan,
): SystemDomainMutationResult {
  assertExpectedSetupVersion(input.expectedSetupVersion, 0);

  return createNoopSystemDomainMutationResult(activeHostPlan, undefined);
}

function createNoPendingResetResult(
  input: VersionedSystemDomainMutationInput,
  activeHostPlan: DomainHostPlan,
  setupState: SystemDomainSetupStateRow,
): SystemDomainMutationResult {
  assertExpectedSetupVersion(input.expectedSetupVersion, setupState.setupVersion);

  return createNoopSystemDomainMutationResult(activeHostPlan, setupState);
}

function createNoopSystemDomainMutationResult(
  activeHostPlan: DomainHostPlan,
  setupState: SystemDomainSetupStateRow | undefined,
): SystemDomainMutationResult {
  const status: SystemDomainStatusResult = mapSystemDomainStatus({
    active: activeHostPlan,
    activeDomainHealth: createUnknownSystemDomainHealth(),
    setupState,
  });

  return {
    operationId: managedResetOperationId,
    setupVersion: status.setupVersion,
    status,
  };
}

function assertActiveManagedHostPlan(hostPlan: DomainHostPlan): void {
  if (hostPlan.domainKind === 'managed' && hostPlan.tlsMode === 'broker-dns01' && hostPlan.publicScheme === 'https') {
    return;
  }

  throw createDomainOperationUnavailableError('The active runtime domain is not managed.');
}

function assertExpectedSetupVersion(expectedVersion: number, currentVersion: number): void {
  if (expectedVersion !== currentVersion) {
    throw createDomainVersionConflictError();
  }
}

function readRequiredPendingOperationId(setupState: SystemDomainSetupStateRow): string {
  if (setupState.pendingOperationId !== null) {
    return setupState.pendingOperationId;
  }

  throw createDomainOperationUnavailableError('Pending domain setup state is incomplete.');
}
