import type { DomainHostPlan, DomainIssuerReference } from '@compartment/contracts';

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
  issuerRef: DomainIssuerReference;
}

export interface KubernetesDomainVersionedInput extends KubernetesOperatorTarget {
  expectedSetupVersion?: number | undefined;
}

export interface KubernetesDomainReleaseUpdate {
  domainCommit?: boolean | undefined;
  domainGeneration?: number | undefined;
  hostPlan?: DomainHostPlan | undefined;
}

export interface KubernetesDomainHelmValues {
  platform?: KubernetesDomainHelmPlatformValues | undefined;
  tls?: KubernetesDomainHelmIssuerValues | undefined;
}

export interface KubernetesDomainHelmIssuerValues {
  issuerRef: DomainIssuerReference;
}
export interface KubernetesDomainHelmPlatformValues {
  baseDomain: string;
  domainCommit: boolean;
  domainGeneration: number;
  domainMode: 'custom' | 'managed';
  publicProtocol: 'http' | 'https';
  tlsMode: 'broker-dns01' | 'internal' | 'issuer';
}
