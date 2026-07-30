import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { resolveKubernetesPublicIngress } from './kubernetes-install-ingress.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallState,
  KubernetesPublicIngress,
} from './kubernetes-install.service.types';

export async function resolveInstallPublicIngress(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: KubernetesInstallState,
): Promise<KubernetesPublicIngress> {
  if (input.domainMode === 'custom' && isReservedKubernetesInstallLocalhostDomain(input.baseDomain)) {
    return {
      ingressClassName: foundationInstall.ingressClassName,
      ingressEndpoint: input.clearConfiguredIngressEndpoint ? null : foundationInstall.ingressEndpoint,
      ingressTargets: input.clearConfiguredIngressEndpoint ? [] : foundationInstall.ingressTargets,
    };
  }
  return await runObservableInstallStep(
    input.progress,
    'Waiting for Ingress endpoint',
    async (): Promise<KubernetesPublicIngress> => await discoverPublicIngress(input, foundationInstall),
    (ingress: KubernetesPublicIngress): string | undefined => ingress.ingressEndpoint?.value,
  );
}

export function applyKubernetesConfiguredIngressState(
  input: KubernetesInstallDeploymentInput,
  state: KubernetesInstallState,
): KubernetesInstallState {
  if (input.clearConfiguredIngressEndpoint) {
    return { ...state, ingressEndpoint: null, ingressTargets: [] };
  }
  if (input.configuredIngressEndpoint === null) {
    return state;
  }
  return {
    ...state,
    ingressEndpoint: input.configuredIngressEndpoint,
    ingressTargets: [input.configuredIngressEndpoint],
  };
}

async function discoverPublicIngress(
  input: KubernetesInstallDeploymentInput,
  foundationInstall: KubernetesInstallState,
): Promise<KubernetesPublicIngress> {
  return await resolveKubernetesPublicIngress({
    kubeconfigPath: input.kubeconfigPath,
    kubeContext: input.kubeContext,
    namespace: input.namespace,
    configuredEndpoint: input.clearConfiguredIngressEndpoint ? null : foundationInstall.ingressEndpoint,
    ingressClassName: foundationInstall.ingressClassName,
    releaseName: input.releaseName,
  });
}
