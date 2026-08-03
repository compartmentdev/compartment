import { readRetainedKubernetesInstallState } from '../../services/kubernetes-install-retained-state.service';
import type { RetainedKubernetesInstallState } from '../../services/kubernetes-install.service.types';
import type { ResolvedKubernetesKubeconfig } from '../../services/kubernetes-install-kubeconfig.service.types';
import type { ReadKubernetesInstallRetainedState } from './install.command.kubernetes-wizard.types';

export function createKubernetesInstallRetainedStateReader(
  kubeconfig: ResolvedKubernetesKubeconfig,
): ReadKubernetesInstallRetainedState {
  return async (
    contextName: string,
    namespace: string,
    releaseName: string,
  ): Promise<RetainedKubernetesInstallState | null> =>
    await readRetainedKubernetesInstallState({
      kubeconfigPath: kubeconfig.path,
      kubeContext: contextName,
      namespace,
      releaseName,
    });
}
