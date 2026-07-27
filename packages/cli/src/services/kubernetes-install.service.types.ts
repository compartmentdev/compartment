import type { KubernetesInstallProgressReporter } from './kubernetes-install-progress.types';

export interface KubernetesInstallDeploymentInput {
  acmeEmail: string;
  apiUrl?: string | undefined;
  baseDomain?: string | undefined;
  brokerUrl?: string | undefined;
  chartPath?: string | undefined;
  domainMode: KubernetesInstallDomainMode;
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
  retainedState: RetainedKubernetesInstallState | null;
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
  managedDomainBrokerToken: string;
  publicIngressIpv4: string;
  publicIngressIpv6: string;
  publicProtocol: KubernetesPublicProtocol;
  tlsMode: KubernetesInstallTlsMode;
}

export interface RetainedManagedDomainState {
  acmeEmail: string;
  baseDomain: string;
  brokerUrl: string;
  brokerToken: string;
  publicProtocol: 'https';
  tlsMode: 'managed';
}

export interface KubernetesInstallSecretValues {
  ingress?: KubernetesInstallIngressValues | undefined;
  platform: KubernetesInstallPlatformValues;
  secrets: KubernetesInstallSecretValueFields;
}

export interface KubernetesInstallIngressValues {
  className: string;
  endpoint: KubernetesIngressEndpointValues;
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
  managedDomainBrokerUrl: string;
  publicIngressIpv4?: string | undefined;
  publicIngressIpv6?: string | undefined;
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
  publicIngressIpv4: string;
  publicIngressIpv6: string;
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

export interface PublicControlPlaneObservation {
  failure: string;
  ready: boolean;
}

export type KubernetesInstallStage = 'foundation' | 'full';
export type KubernetesInstallDomainMode = 'custom' | 'managed';
export type KubernetesInstallTlsMode = 'custom-cert' | 'custom-http' | 'internal' | 'managed';
export type KubernetesIngressEndpointType = 'A' | 'AAAA' | 'hostname';
export type KubernetesPublicProtocol = 'http' | 'https';
