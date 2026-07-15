import type { Informer, KubernetesObject } from '@kubernetes/client-node';
import type { RegisteredInformer } from './kube-informer-registration';

export interface InformerState {
  attempt: number;
  informer: Informer<KubernetesObject>;
  initialListSucceeded: boolean;
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
  onSynchronized: (() => void) | null;
  registration: RegisteredInformer;
  restartTimer: NodeJS.Timeout | null;
}

export interface KubeInformerError extends Error {
  code?: number | undefined;
  statusCode?: number | undefined;
}
