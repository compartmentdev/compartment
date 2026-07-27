import type { ResolvedKubernetesKubeconfig } from './kubernetes-install-kubeconfig.service.types';

export interface KubernetesInstallPreflightInput {
  detectStorageClass: boolean;
  kubeContext?: string | undefined;
  resolvedKubeconfig: ResolvedKubernetesKubeconfig;
}

export interface KubernetesInstallPreflightResult {
  storageClass: string;
}

export interface KubernetesStorageClassMetadata {
  name?: string | undefined;
}

export interface KubernetesStorageClassItem {
  metadata?: KubernetesStorageClassMetadata | undefined;
}

export interface KubernetesStorageClassList {
  items: KubernetesStorageClassItem[];
}
