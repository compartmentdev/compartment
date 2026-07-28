export interface KubernetesNodeList {
  items: KubernetesNodeListItem[];
}

export interface KubernetesNodeListItem {
  metadata?: KubernetesNodeMetadata | undefined;
  spec?: KubernetesNodeSpec | undefined;
  status?: KubernetesNodeStatus | undefined;
}

export interface KubernetesNodeMetadata {
  name?: string | undefined;
}

export interface KubernetesNodeSpec {
  unschedulable?: boolean | undefined;
}

export interface KubernetesNodeStatus {
  conditions?: KubernetesNodeStatusCondition[] | undefined;
}

export interface KubernetesNodeStatusCondition {
  status?: string | undefined;
  type?: string | undefined;
}
