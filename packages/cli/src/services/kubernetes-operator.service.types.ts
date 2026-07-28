import type { DomainCertificateMetadata, DomainHostPlan, DomainIssuerReference } from '@compartment/contracts';

export interface KubernetesOperatorTarget {
  chartPath?: string | undefined;
  kubeContext?: string | undefined;
  kubeconfigPath?: string | undefined;
  namespace: string;
  releaseName: string;
  valuesPath?: string | undefined;
}

export type KubernetesOperatorTargetAction<Result> = (target: KubernetesOperatorTarget) => Promise<Result>;

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
  issuerRef?: DomainIssuerReference | undefined;
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
  pendingCertificate?: string | undefined;
  pendingOperationId?: string | undefined;
  pendingPrivateKey?: string | undefined;
  pendingTlsSecretName?: string | undefined;
}

export interface KubernetesDomainHelmValues {
  customTls: KubernetesDomainHelmTlsValues;
  platform?: KubernetesDomainHelmPlatformValues | undefined;
  tls?: KubernetesDomainHelmIssuerValues | undefined;
}

export interface KubernetesDomainHelmIssuerValues {
  issuerRef: DomainIssuerReference;
}
export interface KubernetesDomainHelmTlsValues {
  existingSecret?: string | undefined;
  operatorCertificate?: string | undefined;
  operatorPrivateKey?: string | undefined;
  operatorSecretName?: string | undefined;
  pendingCertificate?: string | undefined;
  pendingOperationId?: string | undefined;
  pendingPrivateKey?: string | undefined;
  pendingSecretName?: string | undefined;
}

export interface KubernetesDomainHelmPlatformValues {
  baseDomain: string;
  domainCommit: boolean;
  domainGeneration: number;
  domainMode: 'custom' | 'managed';
  publicProtocol: 'http' | 'https';
  tlsMode: 'broker-dns01' | 'internal' | 'issuer' | 'secret';
}

export interface StagedKubernetesDomainCertificate {
  certificate: string;
  fingerprint: string;
  metadata: DomainCertificateMetadata;
  privateKey: string;
  secretName: string;
}
