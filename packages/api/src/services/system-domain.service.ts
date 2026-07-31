import type { DomainHostPlan } from '@compartment/contracts';
import { readApiPublicIngressConfig, type ApiPublicIngressConfig } from '../config';
import { createDomainVersionConflictError, createInvalidDomainHostPlanError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { findSystemDomainSetupState, stageSystemDomainPendingWithExecutor } from '../queries/system-domain.query';
import { getApiConfig } from '../runtime/runtime-access';
import type {
  StageSystemDomainPendingInput,
  SystemDomainMutationQueryResult,
  SystemDomainTransaction,
} from '../queries/system-domain.query.types';
import { runIdempotentSystemDomainMutation } from './system-domain-idempotent-mutation.service';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';
import { normalizeAndValidatePendingDomainHostPlan } from './system-domain-validation.service';
import {
  createSystemDomainMutationResult,
  createUnknownSystemDomainHealth,
  mapSystemDomainStatus,
} from './system-domain-status.mapper';
import { buildRequiredSystemDomainDnsRecords } from './system-domain-dns-proof.service';
import type {
  StageSystemDomainInput,
  SystemDomainMutationResult,
  SystemDomainStatusResult,
} from './system-domain.service.types';

export async function readSystemDomainStatus(): Promise<SystemDomainStatusResult> {
  return mapSystemDomainStatus({
    active: readRuntimeDomainHostPlan(),
    activeDomainHealth: createUnknownSystemDomainHealth(),
    setupState: await findSystemDomainSetupState(),
  });
}

export async function stageSystemDomain(input: StageSystemDomainInput): Promise<SystemDomainMutationResult> {
  return await runIdempotentSystemDomainMutation(
    input.idempotencyKey,
    input,
    async (tx: SystemDomainTransaction): Promise<SystemDomainMutationResult> =>
      await stageSystemDomainInTransaction(tx, input),
  );
}

async function stageSystemDomainInTransaction(
  tx: SystemDomainTransaction,
  input: StageSystemDomainInput,
): Promise<SystemDomainMutationResult> {
  const activeHostPlan: DomainHostPlan = readRuntimeDomainHostPlan();
  const hostPlan: DomainHostPlan = normalizeAndValidatePendingDomainHostPlan(input.hostPlan, activeHostPlan.baseDomain);
  const operationId: string = createId('domop');
  const mutationResult: SystemDomainMutationQueryResult | null = await stageSystemDomainPendingWithExecutor(
    tx,
    buildStageSystemDomainPendingInput(input, hostPlan, operationId),
  );
  if (mutationResult === null) {
    throw createDomainVersionConflictError();
  }

  return createSystemDomainMutationResult(mutationResult, activeHostPlan);
}

function buildStageSystemDomainPendingInput(
  input: StageSystemDomainInput,
  hostPlan: DomainHostPlan,
  operationId: string,
): StageSystemDomainPendingInput {
  const publicIngressConfig: ApiPublicIngressConfig = readApiPublicIngressConfig();
  assertPublicIngressConfigured(publicIngressConfig);

  return {
    expectedSetupVersion: input.expectedSetupVersion,
    operationId,
    pendingBaseDomain: hostPlan.baseDomain,
    pendingCaddyMode: hostPlan.caddyMode,
    pendingDomainKind: hostPlan.domainKind,
    pendingPublicScheme: hostPlan.publicScheme,
    pendingRequiredDnsRecordsJson: JSON.stringify(
      buildRequiredSystemDomainDnsRecords({
        managedDomainBrokerToken: getApiConfig().managedDomainBrokerToken ?? null,
        pendingBaseDomain: hostPlan.baseDomain,
        pendingOperationId: operationId,
        publicIngressConfig,
      }),
    ),
    pendingTlsMode: hostPlan.tlsMode,
  };
}

function assertPublicIngressConfigured(publicIngressConfig: {
  publicIngressIpv4: string | null;
  publicIngressIpv6: string | null;
}): void {
  if (publicIngressConfig.publicIngressIpv4 !== null || publicIngressConfig.publicIngressIpv6 !== null) {
    return;
  }

  throw createInvalidDomainHostPlanError(
    'Custom system domains require COMPARTMENT_PUBLIC_INGRESS_IPV4 or COMPARTMENT_PUBLIC_INGRESS_IPV6.',
  );
}
