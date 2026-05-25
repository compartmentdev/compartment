import type { DomainHostPlan } from '@compartment/contracts';
import { getApiConfig } from '../runtime/runtime-access';
import { synchronizeEdgeAppAccessState } from './app-access-edge.service';
import { checkActiveDomainProbe, checkDomainDns } from './system-domain-check.service';
import type { DomainCheckFailure, DomainCheckResult } from './system-domain-check.service.types';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';
import { mapSystemDomainStatus } from './system-domain-status.mapper';
import { findSystemDomainSetupState } from '../queries/system-domain.query';
import type {
  SystemDomainHealthResult,
  SystemDomainMutationResult,
  SystemDomainStatusResult,
} from './system-domain.service.types';

export async function refreshSystemDomainStatus(): Promise<SystemDomainStatusResult> {
  const activeHostPlan: DomainHostPlan = readRuntimeDomainHostPlan();
  const dnsResult: DomainCheckResult = await checkDomainDns(activeHostPlan);
  let checkResult: DomainCheckResult =
    dnsResult.failure === null
      ? await checkActiveDomainProbe({
          config: getApiConfig(),
          hostPlan: activeHostPlan,
        })
      : dnsResult;
  if (checkResult.failure === null) {
    checkResult = {
      failure: await trySynchronizeEdgeAppAccessState(),
    };
  }

  return mapSystemDomainStatus({
    active: activeHostPlan,
    activeDomainHealth: buildDomainHealthResult(checkResult),
    setupState: await findSystemDomainSetupState(),
  });
}

async function trySynchronizeEdgeAppAccessState(): Promise<DomainCheckFailure | null> {
  try {
    await synchronizeEdgeAppAccessState();

    return null;
  } catch {
    return {
      code: 'edge_sync_failed',
      message: 'Edge app-access state sync failed. Run system domain status to retry.',
    };
  }
}

export async function synchronizeEdgeAfterDomainActivation(
  result: SystemDomainMutationResult,
): Promise<SystemDomainMutationResult> {
  try {
    await synchronizeEdgeAppAccessState();

    return result;
  } catch {
    return {
      ...result,
      status: {
        ...result.status,
        activeDomainHealth: {
          checkedAt: new Date().toISOString(),
          failureCode: 'edge_sync_failed',
          failureMessage: 'Edge app-access state sync failed. Run system domain status to retry.',
          status: 'unhealthy',
        },
      },
    };
  }
}

function buildDomainHealthResult(checkResult: DomainCheckResult): SystemDomainHealthResult {
  return {
    checkedAt: new Date().toISOString(),
    failureCode: checkResult.failure?.code ?? null,
    failureMessage: checkResult.failure?.message ?? null,
    status: checkResult.failure === null ? 'ok' : 'unhealthy',
  };
}
