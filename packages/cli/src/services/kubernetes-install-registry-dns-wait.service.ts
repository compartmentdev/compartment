import { setTimeout as delay } from 'node:timers/promises';
import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { assertKubernetesInstallRegistryDns } from './kubernetes-install-registry-dns.service';
import type { KubernetesInstallDeploymentInput, KubernetesInstallState } from './kubernetes-install.service.types';

const managedRegistryDnsDeadlineMs: number = 2 * 60_000;
const managedRegistryDnsRetryDelayMs: number = 1_000;

export async function waitForKubernetesInstallRegistryDns(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<void> {
  if (isReservedKubernetesInstallLocalhostDomain(state.baseDomain) || state.registryHostname === '') {
    return;
  }
  if (state.domainMode === 'custom') {
    await assertKubernetesInstallRegistryDns(input, state, {
      deadline: Number.POSITIVE_INFINITY,
      nameSuffix: '0',
    });
    return;
  }
  await waitForManagedRegistryDns(input, state);
}

async function waitForManagedRegistryDns(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<void> {
  const deadline: number = Date.now() + managedRegistryDnsDeadlineMs;
  for (let attempt: number = 1; ; attempt += 1) {
    try {
      await assertKubernetesInstallRegistryDns(input, state, {
        deadline,
        nameSuffix: attempt.toString(),
      });
      return;
    } catch (error) {
      const failure: Error = error instanceof Error ? error : new Error('Registry DNS probe failed.');
      if (!isManagedRegistryDnsConvergenceFailure(failure) || Date.now() >= deadline) {
        throw failure;
      }
      await delay(managedRegistryDnsRetryDelayMs);
    }
  }
}

function isManagedRegistryDnsConvergenceFailure(error: Error): boolean {
  if (error.message.includes('Registry DNS probe cleanup failed')) {
    return false;
  }
  return (
    error.message.startsWith('Registry DNS probe failed on node ') ||
    error.message.startsWith('Private registry DNS prerequisite failed on node ')
  );
}
