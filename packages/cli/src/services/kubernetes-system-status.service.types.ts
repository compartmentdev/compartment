import type { JsonValue } from '@compartment/utils';

export interface KubernetesHelmStatusJsonObject {
  info?: JsonValue | undefined;
  name?: JsonValue | undefined;
  status?: JsonValue | undefined;
}

export interface KubernetesWorkloadList {
  items: KubernetesWorkloadListItem[];
}

export interface KubernetesWorkloadListItem {
  kind?: JsonValue | undefined;
  metadata?: KubernetesWorkloadMetadata | undefined;
  spec?: KubernetesWorkloadSpec | undefined;
  status?: KubernetesWorkloadStatus | undefined;
}

export interface KubernetesWorkloadMetadata {
  name?: JsonValue | undefined;
}

export interface KubernetesWorkloadSpec {
  replicas?: JsonValue | undefined;
}

export interface KubernetesWorkloadStatus {
  desiredNumberScheduled?: JsonValue | undefined;
  numberReady?: JsonValue | undefined;
  readyReplicas?: JsonValue | undefined;
}
