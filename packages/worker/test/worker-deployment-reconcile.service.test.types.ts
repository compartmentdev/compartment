import type { ApplyBundle, KubeRuntime } from '@compartment/kube-runtime';
import type { Mock } from 'vitest';

export interface ReconcileMocks {
  applyNetworkPolicy: Mock;
  delay: Mock;
  observeDeploymentReconcile: Mock;
  persistProductJobIntent: Mock;
  projectNetworkPolicyManifests: Mock;
}

export interface RecoveryRuntime extends KubeRuntime {
  apply: Mock;
  delete: Mock;
  observe: Mock;
  read: Mock;
}

export interface ApplyReadRuntime extends KubeRuntime {
  apply: Mock;
  read: Mock;
}

export interface DeleteRuntime extends KubeRuntime {
  delete: Mock;
}

export type ApplyMockCall = [ApplyBundle];
