import type { KubernetesInstallInput } from './kubernetes-install-input.service.types';

export type KubernetesExistingClusterPreflightCheck =
  | 'api resources'
  | 'cert-manager'
  | 'cluster'
  | 'host ownership'
  | 'image trust'
  | 'ingress class'
  | 'permissions'
  | 'release ownership'
  | 'retained identity'
  | 'storage class';

export interface KubernetesExistingClusterPreflightInput {
  apiHosts: readonly string[];
  install: KubernetesInstallInput;
}

export interface KubernetesExistingClusterPreflightResult {
  kubernetesVersion: string;
}

export interface KubernetesObjectMetadata {
  annotations?: Record<string, string> | undefined;
  labels?: Record<string, string> | undefined;
  name?: string | undefined;
  namespace?: string | undefined;
}

export interface KubernetesObject {
  metadata?: KubernetesObjectMetadata | undefined;
}

export interface KubernetesObjectList<T> {
  items: T[];
}

export interface KubernetesApiResource {
  name?: string | undefined;
}

export interface KubernetesApiResourceList {
  groupVersion?: string | undefined;
  resources?: KubernetesApiResource[] | undefined;
}

export interface KubernetesVersionResponse {
  serverVersion?: KubernetesVersionInfo | undefined;
}

export interface KubernetesVersionInfo {
  gitVersion?: string | undefined;
}

export interface KubernetesIngressClass {
  metadata?: KubernetesObjectMetadata | undefined;
}

export interface KubernetesStorageClass {
  metadata?: KubernetesObjectMetadata | undefined;
}

export interface KubernetesIngress {
  metadata?: KubernetesObjectMetadata | undefined;
  spec?: KubernetesIngressSpec | undefined;
}

export interface KubernetesIngressRule {
  host?: string | undefined;
}

export interface KubernetesIngressSpec {
  rules?: KubernetesIngressRule[] | undefined;
}

export interface KubernetesDeployment {
  metadata?: KubernetesObjectMetadata | undefined;
  spec?: KubernetesDeploymentSpec | undefined;
  status?: KubernetesDeploymentStatus | undefined;
}

export interface KubernetesDeploymentSpec {
  replicas?: number | undefined;
}

export interface KubernetesDeploymentStatus {
  availableReplicas?: number | undefined;
  observedGeneration?: number | undefined;
}

export interface KubernetesWebhookConfiguration {
  webhooks?: KubernetesWebhook[] | undefined;
}

export interface KubernetesWebhook {
  clientConfig?: KubernetesWebhookClientConfig | undefined;
}

export interface KubernetesWebhookClientConfig {
  service?: KubernetesWebhookServiceReference | undefined;
}

export interface KubernetesWebhookServiceReference {
  name?: string | undefined;
  namespace?: string | undefined;
}

export interface KubernetesOwnedResource {
  kind: string;
  metadata?: KubernetesObjectMetadata | undefined;
}

export interface KubernetesOwnedResourceTarget {
  kind: string;
  name: string;
  resource: string;
}
