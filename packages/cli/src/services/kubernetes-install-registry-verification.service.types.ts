export interface KubernetesRegistryAcceptancePod {
  status?: KubernetesRegistryAcceptancePodStatus | undefined;
}

export interface KubernetesRegistryAcceptancePodStatus {
  containerStatuses?: KubernetesRegistryAcceptanceContainerStatus[] | undefined;
}

export interface KubernetesRegistryAcceptanceContainerStatus {
  state?: KubernetesRegistryAcceptanceContainerState | undefined;
}

export interface KubernetesRegistryAcceptanceContainerState {
  waiting?: KubernetesRegistryAcceptanceWaitingState | undefined;
}

export interface KubernetesRegistryAcceptanceWaitingState {
  message?: string | undefined;
  reason?: string | undefined;
}

export interface KubernetesRegistryAcceptanceEventList {
  items: KubernetesRegistryAcceptanceEvent[];
}

export interface KubernetesRegistryAcceptanceEvent {
  message?: string | undefined;
  reason?: string | undefined;
}
