import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import {
  assertKubernetesInstallRegistryDns,
  RegistryDnsResolutionError,
} from './kubernetes-install-registry-dns.service';
import type { KubernetesInstallDeploymentInput, KubernetesInstallState } from './kubernetes-install.service.types';

export async function waitForKubernetesInstallRegistryDns(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<string | null> {
  if (isReservedKubernetesInstallLocalhostDomain(state.baseDomain) || state.registryHostname === '') {
    return null;
  }
  try {
    await assertKubernetesInstallRegistryDns(input, state);
    return null;
  } catch (error) {
    if (state.domainMode === 'custom' || !(error instanceof RegistryDnsResolutionError)) {
      throw error;
    }
    return `WARNING: ${error.message} Managed DNS may still be propagating or negatively cached, so installation will continue to the node image-pull verification.`;
  }
}
