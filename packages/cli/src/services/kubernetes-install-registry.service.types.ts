import type { DomainIssuerReference } from '@compartment/contracts';

export interface KubernetesInstallRegistryConfiguration {
  registryHostname: string;
  registryIssuerRef: KubernetesInstallRegistryIssuerReference;
}

export interface KubernetesInstallRegistryIssuerReference extends DomainIssuerReference {
  group: 'cert-manager.io';
}

export interface KubernetesInstallRegistryValueFields {
  hostname?: string | undefined;
  issuerRef?: KubernetesInstallRegistryIssuerValueFields | undefined;
}

export interface KubernetesInstallRegistryIssuerValueFields {
  group?: 'cert-manager.io' | undefined;
  kind: 'Issuer' | 'ClusterIssuer';
  name: string;
}
