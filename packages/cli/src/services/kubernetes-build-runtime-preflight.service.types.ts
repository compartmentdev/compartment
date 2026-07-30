export interface KubernetesBuildRuntimePreflightInput {
  kubeContext?: string | undefined;
  kubeconfigPath: string;
  runtimeClassName: string;
}

export interface KubernetesRuntimeClassMetadata {
  name?: string | undefined;
}

export interface KubernetesRuntimeClassItem {
  handler?: string | undefined;
  metadata?: KubernetesRuntimeClassMetadata | undefined;
}

export interface KubernetesRuntimeClassList {
  items: KubernetesRuntimeClassItem[];
}

export interface ConfiguredBuildRuntimeAssessment {
  detail: string;
  kind: 'configured';
}

export interface DiscoveredBuildRuntimeAssessment {
  detail: string;
  kind: 'discovered';
}

export interface DefaultBuildRuntimeAssessment {
  detail: string;
  kind: 'default-runtime';
}

export interface UnverifiedBuildRuntimeAssessment {
  detail: string;
  kind: 'unverified';
}

export type KubernetesBuildRuntimeAssessment =
  | ConfiguredBuildRuntimeAssessment
  | DefaultBuildRuntimeAssessment
  | DiscoveredBuildRuntimeAssessment
  | UnverifiedBuildRuntimeAssessment;
