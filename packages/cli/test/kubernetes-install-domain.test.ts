import { describe, expect, it } from 'vitest';
import { assertMatchingKubernetesInstallDomain } from '../src/kubernetes-install-domain';
import type {
  ExistingKubernetesInstall,
  KubernetesInstallDeploymentInput,
  KubernetesInstallStage,
} from '../src/services/kubernetes-install.service.types';

describe('Kubernetes install domain matching', (): void => {
  it('gives exact cleanup commands when an incomplete release blocks a domain-mode change', (): void => {
    expect((): void => assertMatchingKubernetesInstallDomain(input(), install('foundation'))).toThrow(
      "helm uninstall compartment -n compartment --kubeconfig '/tmp/operator kubeconfig' --kube-context production && kubectl --kubeconfig '/tmp/operator kubeconfig' --context production delete ns compartment",
    );
  });

  it('keeps domain-mode changes blocked for a working installation', (): void => {
    expect((): void => assertMatchingKubernetesInstallDomain(input(), install('full'))).toThrow(
      'Retry with the original domain selection or use a different release name.',
    );
  });
});

function input(): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: 'owner@example.com',
    chartFullname: 'compartment',
    baseDomain: 'apps.example.com',
    clearConfiguredIngressEndpoint: false,
    configuredIngressEndpoint: null,
    domainMode: 'custom',
    ingressClassName: 'traefik',
    kubeconfigPath: '/tmp/operator kubeconfig',
    kubeContext: 'production',
    namespace: 'compartment',
    registryHostname: 'registry.apps.example.com',
    registryIssuerRef: {
      group: 'cert-manager.io',
      kind: 'ClusterIssuer',
      name: 'registry-ca',
    },
    releaseName: 'compartment',
    valuesPath: '/tmp/values.yaml',
  };
}

function install(stage: KubernetesInstallStage): ExistingKubernetesInstall {
  return {
    acmeEmail: 'owner@example.com',
    baseDomain: '',
    brokerUrl: 'https://broker.example.com',
    domainMode: 'managed',
    installationId: 'installation-id',
    ingressClassName: 'traefik',
    ingressEndpoint: null,
    ingressTargets: [],
    installToken: 'install-token',
    managedDomainAcmeDnsToken: '',
    publicProtocol: 'https',
    registryHostname: '',
    registryIssuerRef: {
      group: 'cert-manager.io',
      kind: 'Issuer',
      name: '',
    },
    stage,
    tlsMode: 'broker-dns01',
  };
}
