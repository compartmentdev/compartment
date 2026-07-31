import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { resolveKubernetesPublicIngress } from './kubernetes-install-ingress.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesIngressEndpoint,
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

export function assertConfiguredManagedDomainEndpoint(input: KubernetesInstallDeploymentInput): void {
  if (input.domainMode === 'managed' && input.configuredIngressEndpoint !== null) {
    assertManagedDomainIngressEndpoint(input.configuredIngressEndpoint);
  }
}

export function assertManagedDomainIngressEndpoint(endpoint: KubernetesIngressEndpoint | null): void {
  if (endpoint?.type === 'hostname') {
    throw new Error(
      'Managed domains are unavailable for a hostname Ingress endpoint because the broker can publish only A/AAAA records to an IP address. Use your own domain with --base-domain instead; do not resolve a cloud load-balancer hostname to an IP.',
    );
  }
  if (endpoint === null) {
    throw new Error('Managed domain install requires a public IPv4 or IPv6 Ingress endpoint.');
  }
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
