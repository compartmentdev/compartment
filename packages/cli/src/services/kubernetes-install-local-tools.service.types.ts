export interface KubernetesInstallLocalToolRequirement {
  binary: 'helm' | 'kubectl';
  installInstruction: string;
  minimumVersion: string;
  versionCommand: readonly string[];
}

export interface KubernetesInstallLocalToolVersions {
  helm: string;
  kubectl: string;
}

export interface KubectlVersionOutput {
  clientVersion?: KubectlClientVersion | undefined;
}

export interface KubectlClientVersion {
  gitVersion?: string | undefined;
}
