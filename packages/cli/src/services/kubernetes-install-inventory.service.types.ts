import type { ResolvedKubernetesKubeconfig } from './kubernetes-install-kubeconfig.service.types';

export interface KubernetesContextChoice {
  apiServer: string;
  name: string;
}

export interface KubernetesStorageClassChoice {
  default: boolean;
  name: string;
}

export interface KubernetesInstallInventoryInput {
  resolvedKubeconfig: ResolvedKubernetesKubeconfig;
}

export interface KubernetesConfigCluster {
  cluster?: KubernetesConfigClusterValue | undefined;
  name?: string | undefined;
}

export interface KubernetesConfigClusterValue {
  server?: string | undefined;
}

export interface KubernetesConfigContext {
  context?: KubernetesConfigContextValue | undefined;
  name?: string | undefined;
}

export interface KubernetesConfigContextValue {
  cluster?: string | undefined;
}

export interface KubernetesConfigView {
  clusters?: KubernetesConfigCluster[] | undefined;
  contexts?: KubernetesConfigContext[] | undefined;
}

export interface KubernetesInventoryMetadata {
  annotations?: Record<string, string> | undefined;
  name?: string | undefined;
}

export interface KubernetesInventoryResource {
  metadata?: KubernetesInventoryMetadata | undefined;
}

export interface KubernetesInventoryList {
  items?: KubernetesInventoryResource[] | undefined;
}

export interface KubernetesInstallInventory {
  contexts: readonly KubernetesContextChoice[];
}

export interface KubernetesInstallResourceInventory {
  ingressClasses: readonly string[];
  storageClasses: readonly KubernetesStorageClassChoice[];
}
