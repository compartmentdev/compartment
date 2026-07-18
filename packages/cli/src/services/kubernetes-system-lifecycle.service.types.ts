import type { JsonValue } from '@compartment/utils';
import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';

export interface KubernetesSystemUpdateInput extends KubernetesOperatorTarget {
  valuesPath: string;
  version: string;
}

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

export interface KubernetesPlatformUpdateImageValues {
  images: Record<'api' | 'caddy' | 'edge' | 'worker', KubernetesPlatformUpdateImageValue>;
}

export interface KubernetesPlatformUpdateImageValue {
  digest: '';
  tag: string;
}
