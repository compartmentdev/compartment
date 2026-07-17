import type { DomainHostPlan } from '@compartment/contracts';

export interface KubernetesOperatorTarget {
  chartPath?: string | undefined;
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
  valuesPath?: string | undefined;
}

export interface KubernetesSystemApiRequest {
  body?: object | undefined;
  idempotencyKey?: string | undefined;
  method: 'GET' | 'POST';
  path: string;
}

export interface KubernetesSystemApiResponseEnvelope {
  body: string;
  statusCode: number;
}

export interface KubernetesResourceList {
  items: KubernetesResourceListItem[];
}

export interface KubernetesResourceListItem {
  metadata?: KubernetesResourceMetadata | undefined;
}

export interface KubernetesResourceMetadata {
  name?: string | undefined;
}

export interface KubernetesDomainSetInput extends KubernetesOperatorTarget {
  baseDomain: string;
  tlsMode: 'custom-cert' | 'external';
}

export interface KubernetesDomainVersionedInput extends KubernetesOperatorTarget {
  expectedSetupVersion?: number | undefined;
}

export interface KubernetesDomainCertificateInput extends KubernetesDomainVersionedInput {
  certificateFile: string;
  privateKeyFile: string;
}

export interface KubernetesDomainReleaseUpdate {
  customTlsSecretName?: string | undefined;
  domainCommit?: boolean | undefined;
  domainGeneration?: number | undefined;
  hostPlan?: DomainHostPlan | undefined;
  operatorCertificate?: string | undefined;
  operatorPrivateKey?: string | undefined;
  operatorTlsSecretName?: string | undefined;
  pendingOperationId?: string | undefined;
}

export interface KubernetesDomainHelmValues {
  customTls: KubernetesDomainHelmTlsValues;
  platform?: KubernetesDomainHelmPlatformValues | undefined;
}

export interface KubernetesDomainHelmTlsValues {
  existingSecret?: string | undefined;
  operatorCertificate?: string | undefined;
  operatorPrivateKey?: string | undefined;
  operatorSecretName?: string | undefined;
  pendingOperationId?: string | undefined;
}

export interface KubernetesDomainHelmPlatformValues {
  baseDomain: string;
  domainCommit: boolean;
  domainGeneration: number;
  domainMode: 'custom' | 'managed';
  publicProtocol: 'http' | 'https';
  tlsMode: 'custom-cert' | 'custom-http' | 'internal' | 'managed';
}

export interface StagedKubernetesDomainCertificate {
  certificate: string;
  fingerprint: string;
  privateKey: string;
  secretName: string;
}
