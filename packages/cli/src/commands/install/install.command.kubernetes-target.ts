import { assertClusterVersion } from '../../services/kubernetes-existing-cluster-preflight.cluster';
import {
  isKubectlVersionCompatibleWithServer,
  kubernetesInstallCompatibility,
} from '../../services/kubernetes-install-compatibility.service';
import type { KubernetesInstallLocalToolVersions } from '../../services/kubernetes-install-local-tools.service.types';
import type { ResolvedKubernetesKubeconfig } from '../../services/kubernetes-install-kubeconfig.service.types';
import type { CliCommandDependencies } from '../command.types';

export async function verifyKubernetesInstallTarget(
  dependencies: CliCommandDependencies,
  kubeconfig: ResolvedKubernetesKubeconfig,
  localTools: KubernetesInstallLocalToolVersions,
  renderDetection: boolean,
): Promise<void> {
  const kubernetesVersion: string = await assertClusterVersion({
    kubeconfigPath: kubeconfig.path,
    kubeContext: kubeconfig.contextName,
  });
  assertKubectlServerCompatibility(localTools.kubectl, kubernetesVersion);
  if (renderDetection) {
    renderDetectedKubernetesTarget(dependencies, kubeconfig, kubernetesVersion, localTools);
  }
}

function assertKubectlServerCompatibility(kubectlVersion: string, kubernetesVersion: string): void {
  if (!isKubectlVersionCompatibleWithServer(kubectlVersion, kubernetesVersion)) {
    throw new Error(
      `kubectl ${kubectlVersion} is incompatible with Kubernetes ${kubernetesVersion}. kubectl must be within ${String(kubernetesInstallCompatibility.kubectlMaximumMinorSkew)} minor version of the API server.`,
    );
  }
}

function renderDetectedKubernetesTarget(
  dependencies: CliCommandDependencies,
  kubeconfig: ResolvedKubernetesKubeconfig,
  kubernetesVersion: string,
  localTools: KubernetesInstallLocalToolVersions,
): void {
  dependencies.io.stderr(`Checking Kubernetes
  ✓ Detected cluster: ${kubeconfig.contextName}
  ✓ API server: ${kubeconfig.clusterServer}
  ✓ Kubernetes ${kubernetesVersion}
  ✓ kubectl ${localTools.kubectl}
  ✓ Helm ${localTools.helm}

`);
}
