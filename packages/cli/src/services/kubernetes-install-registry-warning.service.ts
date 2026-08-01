import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { waitForKubernetesInstallRegistryDns } from './kubernetes-install-registry-dns-wait.service';
import { RegistryNodePullDnsError } from './kubernetes-install-registry-verification-error';
import { verifyKubernetesInstallRegistryNodePull } from './kubernetes-install-registry-verification.service';
import type { KubernetesInstallDeploymentInput, KubernetesInstallState } from './kubernetes-install.service.types';

export async function checkKubernetesInstallRegistryDns(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
  domainMode: 'custom' | 'managed',
): Promise<void> {
  if (state.domainMode !== domainMode || isReservedKubernetesInstallLocalhostDomain(state.baseDomain)) {
    return;
  }
  const warning: string | null = await runObservableInstallStep(
    input.progress,
    'Checking private registry DNS from cluster nodes',
    async (): Promise<string | null> => await waitForKubernetesInstallRegistryDns(input, state),
  );
  reportKubernetesInstallWarning(input, warning);
}

export async function verifyObservableKubernetesRegistry(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<string | null> {
  return await runObservableInstallStep(
    input.progress,
    'Verifying private registry pull on every node',
    async (): Promise<string | null> => await verifyKubernetesInstallRegistryNodePullWithManagedDnsGrace(input, state),
  );
}

export async function verifyKubernetesInstallRegistryNodePullWithManagedDnsGrace(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<string | null> {
  try {
    await verifyKubernetesInstallRegistryNodePull(input, state);
    return null;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error('Registry node-pull verification failed.');
    }
    return resolveManagedRegistryNodePullFailure(state, error);
  }
}

function resolveManagedRegistryNodePullFailure(state: KubernetesInstallState, error: Error): string {
  if (state.domainMode !== 'managed' || !(error instanceof RegistryNodePullDnsError)) {
    throw error;
  }
  return `WARNING: ${error.message}\nThe managed registry hostname may still be propagating or negatively cached. Installation will continue, but node image pulls cannot succeed until ${state.registryHostname} resolves to the retained registry Service address. Re-run compartment install after DNS resolves to repeat the node-pull verification.`;
}

export function reportKubernetesInstallWarning(input: KubernetesInstallDeploymentInput, warning: string | null): void {
  if (warning !== null) {
    input.progress?.report(warning, { renderMode: 'line' });
  }
}
