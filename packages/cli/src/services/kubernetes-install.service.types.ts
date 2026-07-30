import type { DomainIssuerReference } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import type { KubernetesInstallProgressReporter } from './kubernetes-install-progress.types';
import type {
  KubernetesInstallRegistryConfiguration,
  KubernetesInstallRegistryIssuerReference,
} from './kubernetes-install-registry.service.types';

export interface KubernetesInstallDeploymentInput extends KubernetesInstallRegistryConfiguration {
  acmeEmail: string;
  apiUrl?: string | undefined;
  baseDomain?: string | undefined;
  brokerUrl?: string | undefined;
  chartPath?: string | undefined;
  clearConfiguredIngressEndpoint: boolean;
  configuredIngressEndpoint: KubernetesIngressEndpoint | null;
  domainMode: KubernetesInstallDomainMode;
  ingressClassName: string;
  kubeconfigPath?: string | undefined;
  kubeContext?: string | undefined;
  managedDomainRequestedLabelSource?: string | undefined;
  namespace: string;
  progress?: KubernetesInstallProgressReporter | undefined;
  releaseName: string;
  valuesPath: string;
}

export interface KubernetesInstallDeploymentResult {
  apiUrl: string;
  baseDomain: string;
  installToken: string;
}

export interface KubernetesInstallInspection {
  existingInstall: ExistingKubernetesInstall | null;
  releaseValues: JsonValue | null;
  retainedState: RetainedKubernetesInstallState | null;
}

export interface ExistingKubernetesInstallRelease {
  install: ExistingKubernetesInstall;
  values: JsonValue;
}

export interface KubernetesInstallHelmMaterial {
  chartPath: string;
  imageTrustValuesPath: string;
  installValuesPath: string;
  platformImageValuesPath: string;
}

export interface ExistingKubernetesInstall extends KubernetesInstallState {
  installToken: string | null;
  stage: KubernetesInstallStage;
}

export type RetainedKubernetesInstallState = KubernetesInstallState;

export interface KubernetesInstallState {
  acmeEmail: string;
  baseDomain: string;
  brokerUrl: string;
  domainMode: KubernetesInstallDomainMode;
  installationId: string;
  ingressClassName: string;
  ingressEndpoint: KubernetesIngressEndpoint | null;
  ingressTargets: KubernetesIngressEndpoint[];
  managedDomainAllocationId: string;
  managedDomainBrokerToken: string;
  publicProtocol: KubernetesPublicProtocol;
  registryHostname: string;
  registryIssuerRef: KubernetesInstallRegistryIssuerReference;
  tlsMode: KubernetesInstallTlsMode;
}

export interface RetainedManagedDomainState {
  acmeEmail: string;
  allocationId: string;
  baseDomain: string;
  brokerUrl: string;
  brokerToken: string;
  issuerRef: DomainIssuerReference;
  publicProtocol: 'https';
  tlsMode: 'broker-dns01';
}

export interface KubernetesInstallSecretValues {
  ingress?: KubernetesInstallIngressValues | undefined;
  platform: KubernetesInstallPlatformValues;
  registry: KubernetesInstallRegistryValues;
  secrets: KubernetesInstallSecretValueFields;
}

export interface KubernetesInstallRegistryValues {
  hostname: string;
  issuerRef: KubernetesInstallRegistryIssuerReference;
}

export interface KubernetesInstallIngressValues {
  className: string;
  endpoint: KubernetesIngressEndpointValues;
  targetsJson: string;
}

export interface KubernetesIngressEndpointValues {
  type: '' | KubernetesIngressEndpointType;
  value: string;
}

export interface KubernetesIngressEndpoint {
  type: KubernetesIngressEndpointType;
  value: string;
}

export interface KubernetesInstallPlatformValues {
  acmeEmail: string;
  baseDomain: string;
  domainGeneration: number;
  domainMode: KubernetesInstallDomainMode;
  installationId: string;
  managedDomainAllocationId?: string | undefined;
  managedDomainBrokerUrl: string;
  publicProtocol?: KubernetesPublicProtocol | undefined;
  tlsMode?: KubernetesInstallTlsMode | undefined;
}

export interface KubernetesInstallSecretValueFields {
  installToken: string;
  managedDomainBrokerToken: string;
}

export interface KubernetesPublicIngress {
  ingressClassName: string;
  ingressEndpoint: KubernetesIngressEndpoint | null;
  ingressTargets: KubernetesIngressEndpoint[];
}

export interface KubernetesPublicIngressResolutionInput {
  configuredEndpoint: KubernetesIngressEndpoint | null;
  ingressClassName: string;
  kubeconfigPath?: string | undefined;
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
}

export interface KubernetesIngressAddress {
  hostname?: string | undefined;
  ip?: string | undefined;
}

export interface KubernetesIngressListItem {
  status?: KubernetesIngressStatus | undefined;
}

export interface KubernetesIngressList {
  items: KubernetesIngressListItem[];
}

export interface KubernetesSecretList {
  items: KubernetesSecretListItem[];
}

export interface KubernetesSecretListItem {
  data?: Record<string, string> | undefined;
}

export interface KubernetesPodList {
  items: KubernetesPodListItem[];
}

export interface KubernetesPodListItem {
  metadata?: KubernetesPodMetadata | undefined;
  status?: KubernetesPodStatus | undefined;
}

export interface KubernetesPodMetadata {
  name?: string | undefined;
}

export interface KubernetesPodStatus {
  conditions?: KubernetesPodStatusCondition[] | undefined;
  phase?: string | undefined;
}

export interface KubernetesPodStatusCondition {
  status?: string | undefined;
  type?: string | undefined;
}

export interface KubernetesIngressStatus {
  loadBalancer?: KubernetesIngressLoadBalancerStatus | undefined;
}

export interface KubernetesIngressLoadBalancerStatus {
  ingress?: KubernetesIngressAddress[] | undefined;
}

export interface HelmReleaseSummary {
  name: string;
  status: string;
}

export type KubernetesInstallStage = 'foundation' | 'full';
export type KubernetesInstallDomainMode = 'custom' | 'managed';
export type KubernetesInstallTlsMode = 'broker-dns01' | 'internal' | 'issuer';
export type KubernetesIngressEndpointType = 'A' | 'AAAA' | 'hostname';
export type KubernetesPublicProtocol = 'http' | 'https';
