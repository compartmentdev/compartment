import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { resolveKubernetesPublicIngress } from './kubernetes-install-ingress.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesPublicIngress,
} from './kubernetes-install.service.types';

export async function resolveInstallPublicIngress(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
): Promise<KubernetesPublicIngress> {
  if (input.domainMode === 'custom' && isReservedKubernetesInstallLocalhostDomain(input.baseDomain)) {
    return {
      ingressClassName: foundationInstall.ingressClassName,
      ingressEndpoint: foundationInstall.ingressEndpoint,
      ingressTargets: foundationInstall.ingressTargets,
    };
  }
  return await runObservableInstallStep(
    input.progress,
    'Waiting for Ingress endpoint',
    async (): Promise<KubernetesPublicIngress> => await discoverPublicIngress(input, foundationInstall),
    (ingress: KubernetesPublicIngress): string | undefined => ingress.ingressEndpoint?.value,
  );
}

async function discoverPublicIngress(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: ExistingKubernetesInstall,
): Promise<KubernetesPublicIngress> {
  return await resolveKubernetesPublicIngress({
    kubeconfigPath: input.kubeconfigPath,
    kubeContext: input.kubeContext,
    namespace: input.namespace,
    configuredEndpoint: foundationInstall.ingressEndpoint,
    ingressClassName: foundationInstall.ingressClassName,
    releaseName: input.releaseName,
  });
}
