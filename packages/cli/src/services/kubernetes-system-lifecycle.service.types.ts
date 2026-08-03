import type { KubernetesOperatorTarget } from './kubernetes-operator.service.types';

export interface KubernetesSystemUpdateInput extends KubernetesOperatorTarget {
  valuesPath: string;
  version: string;
}
