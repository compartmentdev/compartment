export interface KubernetesInstallDeploymentInput {
  acmeEmail: string;
  apiUrl?: string | undefined;
  baseDomain?: string | undefined;
  brokerUrl?: string | undefined;
  chartPath?: string | undefined;
  domainMode: KubernetesInstallDomainMode;
  kubeContext?: string | undefined;
  managedDomainRequestedLabelSource?: string | undefined;
  namespace: string;
  releaseName: string;
  valuesPath: string;
}

export interface KubernetesInstallDeploymentResult {
  apiUrl: string;
  baseDomain: string;
  installToken: string;
}

export interface KubernetesInstallHelmMaterial {
  chartPath: string;
  imageTrustValuesPath: string;
  installValuesPath: string;
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
  platform: KubernetesInstallPlatformValues;
  secrets: KubernetesInstallSecretValueFields;
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
  publicIngressIpv4: string;
  publicIngressIpv6: string;
}

export interface KubernetesPublicIngressResolutionInput extends KubernetesPublicIngress {
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
}

export interface KubernetesServiceAddress {
  hostname?: string | undefined;
  ip?: string | undefined;
}

export interface KubernetesServiceListItem {
  spec?: KubernetesServiceSpec | undefined;
  status?: KubernetesServiceStatus | undefined;
}

export interface KubernetesServiceList {
  items: KubernetesServiceListItem[];
}

export interface KubernetesSecretList {
  items: KubernetesSecretListItem[];
}

export interface KubernetesSecretListItem {
  data?: Record<string, string> | undefined;
}

export interface KubernetesServiceSpec {
  type?: string | undefined;
}

export interface KubernetesServiceStatus {
  loadBalancer?: KubernetesServiceLoadBalancerStatus | undefined;
}

export interface KubernetesServiceLoadBalancerStatus {
  ingress?: KubernetesServiceAddress[] | undefined;
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
export type KubernetesPublicProtocol = 'http' | 'https';
