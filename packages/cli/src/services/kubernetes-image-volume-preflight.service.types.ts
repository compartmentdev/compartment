export interface KubernetesImageVolumeCapabilityTarget {
  kubeconfigPath?: string | undefined;
  kubeContext?: string | undefined;
  namespace: string;
}
