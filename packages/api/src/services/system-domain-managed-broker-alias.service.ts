import {
  managedDomainAliasPathname,
  type DomainHostPlan,
  type ManagedDomainAliasUpsertRequest,
} from '@compartment/contracts';
import { getApiConfig } from '../runtime/runtime-access';
import { fetchManagedDomainBrokerHttp } from './outbound-http.service';
import type { DomainCheckFailure } from './system-domain-check.service.types';
import type { SystemDomainMutationResult } from './system-domain.service.types';

interface ManagedDomainBrokerAliasConfig {
  token: string;
}

const managedDomainBrokerAliasRequestTimeoutMs: number = 10_000;

export async function synchronizeManagedDomainBrokerAliasAfterDomainActivation(
  result: SystemDomainMutationResult,
): Promise<SystemDomainMutationResult> {
  const failure: DomainCheckFailure | null = await trySynchronizeManagedDomainBrokerAlias(result.status.active);
  if (failure === null) {
    return result;
  }

  return {
    ...result,
    status: {
      ...result.status,
      activeDomainHealth: {
        checkedAt: new Date().toISOString(),
        failureCode: failure.code,
        failureMessage: failure.message,
        status: 'unhealthy',
      },
    },
  };
}

export async function trySynchronizeManagedDomainBrokerAlias(
  hostPlan: DomainHostPlan,
): Promise<DomainCheckFailure | null> {
  try {
    await synchronizeManagedDomainBrokerAlias(hostPlan);

    return null;
  } catch {
    return {
      code: 'broker_alias_sync_failed',
      message: 'Managed-domain broker alias sync failed. Run system domain status to retry.',
    };
  }
}

async function synchronizeManagedDomainBrokerAlias(hostPlan: DomainHostPlan): Promise<void> {
  if (hostPlan.domainKind === 'custom') {
    await upsertManagedDomainBrokerAlias(hostPlan);
    return;
  }
  if (hostPlan.domainKind === 'managed') {
    await clearManagedDomainBrokerAliases();
  }
}

async function upsertManagedDomainBrokerAlias(hostPlan: DomainHostPlan): Promise<void> {
  const config: ManagedDomainBrokerAliasConfig | null = readManagedDomainBrokerAliasConfig();
  if (config === null) {
    return;
  }

  const request: ManagedDomainAliasUpsertRequest = {
    baseDomain: hostPlan.baseDomain,
  };
  const response: Response = await fetchManagedDomainBrokerHttp(managedDomainAliasPathname, {
    body: JSON.stringify(request),
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    method: 'PUT',
    signal: AbortSignal.timeout(managedDomainBrokerAliasRequestTimeoutMs),
  });
  if (response.ok) {
    return;
  }

  throw new Error(`Managed-domain broker alias registration failed with status ${response.status}.`);
}

async function clearManagedDomainBrokerAliases(): Promise<void> {
  const config: ManagedDomainBrokerAliasConfig | null = readManagedDomainBrokerAliasConfig();
  if (config === null) {
    return;
  }

  const response: Response = await fetchManagedDomainBrokerHttp(managedDomainAliasPathname, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    method: 'DELETE',
    signal: AbortSignal.timeout(managedDomainBrokerAliasRequestTimeoutMs),
  });
  if (response.ok) {
    return;
  }

  throw new Error(`Managed-domain broker alias cleanup failed with status ${response.status}.`);
}

function readManagedDomainBrokerAliasConfig(): ManagedDomainBrokerAliasConfig | null {
  const brokerToken: string | null = getApiConfig().managedDomainBrokerToken ?? null;
  if (brokerToken === null) {
    return null;
  }

  return {
    token: brokerToken,
  };
}
