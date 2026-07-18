import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';

export interface KubernetesSystemUpdateInput extends KubernetesOperatorTarget {
  valuesPath: string;
  version: string;
}

export interface KubernetesPlatformUpdateImageValues {
  images: Record<'api' | 'caddy' | 'edge' | 'worker', KubernetesPlatformUpdateImageValue>;
}

export interface KubernetesPlatformUpdateImageValue {
  digest: '';
  tag: string;
}
