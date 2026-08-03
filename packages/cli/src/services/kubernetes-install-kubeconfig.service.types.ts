import type { JsonValue } from '@compartment/utils';

export type KubernetesInstallKubeconfigFailureReason = 'context-not-found' | 'no-usable-cluster';

export interface KubernetesKubeconfigResolutionInput {
  contextName?: string | undefined;
  env: NodeJS.ProcessEnv;
  homeDirectory: string;
  k3sPath?: string | undefined;
}

export interface KubernetesKubeconfigCandidate {
  configured: boolean;
  displayPath: string;
  label?: string | undefined;
  path: string;
}

export interface KubernetesKubeconfigCandidateResult {
  document: KubernetesKubeconfigDocument | null;
  reason: string;
  resolved: ResolvedKubernetesKubeconfig | null;
}

export type KubernetesKubeconfigDocument = Record<string, JsonValue>;

export interface ResolvedKubernetesKubeconfig {
  clusterServer: string;
  contextName: string;
  label?: string | undefined;
  materializedDirectory?: string | undefined;
  path: string;
}
