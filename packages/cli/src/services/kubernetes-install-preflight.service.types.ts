import type { ResolvedKubernetesKubeconfig } from './kubernetes-install-kubeconfig.service.types';

export interface KubernetesInstallPreflightInput {
  detectStorageClass: boolean;
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
  resolvedKubeconfig: ResolvedKubernetesKubeconfig;
}

export interface KubernetesInstallPreflightResult {
  ingressWarning?: KubernetesIngressPortConflict | undefined;
  storageClass: string;
}

export interface KubernetesServiceMetadata {
  labels?: Record<string, string> | undefined;
  name?: string | undefined;
  namespace?: string | undefined;
}

export interface KubernetesServicePort {
  port?: number | undefined;
}

export interface KubernetesPreflightServiceItem {
  metadata?: KubernetesServiceMetadata | undefined;
  spec?: KubernetesPreflightServiceSpec | undefined;
}

export interface KubernetesPreflightServiceSpec {
  ports?: KubernetesServicePort[] | undefined;
  type?: string | undefined;
}

export interface KubernetesPreflightServiceList {
  items: KubernetesPreflightServiceItem[];
}

export interface KubernetesStorageClassItem {
  metadata?: Pick<KubernetesServiceMetadata, 'name'> | undefined;
}

export interface KubernetesStorageClassList {
  items: KubernetesStorageClassItem[];
}

export interface KubernetesIngressPortConflict {
  name: string;
  namespace: string;
}
