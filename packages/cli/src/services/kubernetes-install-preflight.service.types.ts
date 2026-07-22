export interface KubernetesKubeconfigResolutionInput {
  contextName?: string | undefined;
  env: NodeJS.ProcessEnv;
  homeDirectory: string;
  k3sPath?: string | undefined;
}

export interface KubernetesKubeconfigCandidate {
  configured: boolean;
  displayPath: string;
  label?: string | undefined;
  path: string;
}

export interface KubernetesKubeconfigCandidateResult {
  reason: KubernetesKubeconfigFailureReason;
  resolved: ResolvedKubernetesKubeconfig | null;
}

export type KubernetesKubeconfigFailureReason = 'no current context' | 'not found' | 'unusable';

export interface ResolvedKubernetesKubeconfig {
  clusterServer: string;
  contextName: string;
  label?: string | undefined;
  path: string;
}

export interface KubernetesInstallPreflightInput {
  detectStorageClass: boolean;
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
  resolvedKubeconfig: ResolvedKubernetesKubeconfig;
}

export interface KubernetesInstallPreflightResult {
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
