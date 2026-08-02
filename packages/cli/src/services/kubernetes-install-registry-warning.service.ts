import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { verifyKubernetesInstallRegistryNodePull } from './kubernetes-install-registry-verification.service';
import type { KubernetesInstallDeploymentInput, KubernetesInstallState } from './kubernetes-install.service.types';

export async function verifyObservableKubernetesRegistry(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<string | null> {
  return await runObservableInstallStep(
    input.progress,
    'Verifying private registry pull on every node',
    async (): Promise<string | null> => await verifyKubernetesInstallRegistryNodePullForInstall(input, state),
  );
}

export async function verifyKubernetesInstallRegistryNodePullForInstall(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): Promise<string | null> {
  await verifyKubernetesInstallRegistryNodePull(input, state);
  return null;
}

export function reportKubernetesInstallWarning(input: KubernetesInstallDeploymentInput, warning: string | null): void {
  if (warning !== null) {
    input.progress?.report(warning, { renderMode: 'line' });
  }
}
