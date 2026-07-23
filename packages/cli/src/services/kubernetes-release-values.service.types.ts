export interface KubernetesReleaseValuesInput {
  kubeContext?: string | undefined;
  kubeconfigPath?: string | undefined;
  namespace: string;
  releaseName: string;
}
