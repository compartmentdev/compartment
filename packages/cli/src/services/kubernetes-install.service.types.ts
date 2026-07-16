export interface KubernetesInstallDeploymentInput {
  apiUrl: string;
  baseDomain: string;
  chartPath?: string | undefined;
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
  valuesPath: string;
}

export interface KubernetesInstallDeploymentResult {
  installToken: string;
}

export interface ExistingKubernetesInstall {
  baseDomain: string;
  installToken: string | null;
  stage: KubernetesInstallStage;
}

export interface HelmReleaseSummary {
  name: string;
  status: string;
}

export interface PublicControlPlaneObservation {
  failure: string;
  ready: boolean;
}

export type KubernetesInstallStage = 'foundation' | 'full';
