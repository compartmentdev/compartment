export interface KubernetesReleaseValuesInput {
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
}
