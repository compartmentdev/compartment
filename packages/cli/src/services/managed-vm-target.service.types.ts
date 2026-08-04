import type { ResolvedKubernetesKubeconfig } from './kubernetes-install-kubeconfig.service.types';

export type InstallTarget = 'kubernetes' | 'vm';

export interface InstallTargetSelectionInput {
  contextName?: string | undefined;
  env: NodeJS.ProcessEnv;
  explicitTarget?: InstallTarget | undefined;
  homeDirectory: string;
  interactive: boolean;
  managedStateExists: boolean;
}

export interface ExplicitInstallTargetDiscovery {
  kind: 'explicit';
  target: InstallTarget;
}

export interface ManagedResumeInstallTargetDiscovery {
  kind: 'managed-resume';
  target: 'vm';
}

export interface NoClusterInstallTargetDiscovery {
  kind: 'no-cluster';
  target: 'vm';
}

export interface KubernetesInstallTargetDiscovery {
  kind: 'kubernetes';
  kubeconfig: ResolvedKubernetesKubeconfig;
  target: 'kubernetes';
}

export interface UnavailableKubernetesInstallTargetDiscovery {
  kind: 'unavailable-kubernetes';
  kubeconfig: ResolvedKubernetesKubeconfig;
  reason: string;
  target: 'kubernetes';
}

export type InstallTargetDiscovery =
  | ExplicitInstallTargetDiscovery
  | KubernetesInstallTargetDiscovery
  | ManagedResumeInstallTargetDiscovery
  | NoClusterInstallTargetDiscovery
  | UnavailableKubernetesInstallTargetDiscovery;
